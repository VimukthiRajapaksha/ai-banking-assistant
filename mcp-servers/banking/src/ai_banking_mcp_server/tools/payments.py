"""The make_payment tool: step up, confirm, then pay.

A payment is the one thing here that moves money, so it is the one thing that
asks the customer twice, for two different things:

  1. **Are you actually here?** A step-up authentication, driven by this server
     against ThunderID (outbound/stepup.py). A passkey if the customer has one,
     a password if not. This proves presence; it authorises nothing.
  2. **Is THIS the payment you meant?** The beneficiary, the funding account,
     the amount and the reason, shown together, approved as one thing. The
     approval is recorded as a single-use consent bound to those values.

They are separate rounds because the protocol makes them separate: a tool call
carries one `input_responses`/`request_state` channel (see the MCP
multi-round-trip spec), so two questions cannot share a round. That happens to
be the right shape anyway -- proving presence before showing the details means
a stolen session cannot even see what is about to be paid.

Each round returns an `InputRequiredResult` and the client calls the same tool
again with the answer. `request_state` carries which question is outstanding;
the SDK seals it, binds it to this tool, these arguments and this principal, and
rejects anything replayed from elsewhere. The stage name inside is ours: the SDK
cannot know which of OUR questions an answer belongs to, and without it an
answer to the step-up could be counted as an approval of the payment.

The funding account is chosen by the customer at the confirmation step and is
never a tool argument, so a model that misreads "my savings" cannot move money
from the wrong account.
"""

from __future__ import annotations

import json
import logging
import re
from decimal import Decimal, InvalidOperation
from typing import Annotated

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver import Context, MCPServer
from mcp.types import (
    ElicitRequest,
    ElicitRequestFormParams,
    InputRequiredResult,
    ToolAnnotations,
)
from pydantic import Field

from ai_banking_mcp_server.outbound.actor_chain import ActorChain, ActorChainError
from ai_banking_mcp_server.outbound.client import BankApiError
from ai_banking_mcp_server.outbound.consent import ConsentClient, ConsentServiceError
from ai_banking_mcp_server.outbound.oauth import BankToken
from ai_banking_mcp_server.outbound.payments import execute_payment
from ai_banking_mcp_server.outbound.stepup import (
    StepUpClient,
    StepUpError,
    StepUpState,
    assertion_subject,
    authenticators,
)
from ai_banking_mcp_server.outbound.token_exchange import (
    BankTokenExchangeError,
    exchange_for_bank_token,
)
from ai_banking_mcp_server.settings import Settings
from ai_banking_mcp_server.state import (
    BankTokenCache,
    SessionKeyError,
    SessionLocks,
    session_key,
)
from ai_banking_mcp_server.tools import messages
from ai_banking_mcp_server.tools.catalog import CATALOG, MAKE_PAYMENT
from ai_banking_mcp_server.tools.consent_gate import agent_actor_token

logger = logging.getLogger(__name__)
audit = logging.getLogger("ai_banking_mcp_server.audit")

#: The two questions this tool asks. Separate keys so an answer to one can never
#: be read as an answer to the other.
STEP_UP_KEY = "payment_step_up"
AUTHORIZATION_KEY = "payment_authorization"

#: Reserved property carrying the WebAuthn options for the browser to sign.
#: Elicitation schemas are normalised on the wire -- only `type`, `title`,
#: `description` and `default` survive on a property -- so the challenge travels
#: as a property default, which is the one field big enough and left alone.
PASSKEY_CHALLENGE_KEY = "passkey_challenge"

#: Property the browser puts the signed WebAuthn assertion back into.
PASSKEY_RESPONSE_KEY = "passkey_response"

#: Results the model reads when a payment stops short. Each says that no money
#: moved, because "did it go through?" is the first thing a customer asks, and
#: what to do next, because a reflexive retry here is a second payment.
PAYMENT_DECLINED = (
    "No payment was made: the customer cancelled it. Acknowledge that, and do not call "
    "make_payment again unless they ask for a new payment."
)
PASSKEY_REQUIRED = (
    "No payment was made: payments need a passkey and the customer has not set one up. Do not retry. "
    "Tell them to add a passkey from their Security settings and then ask for the payment again."
)
PAYMENT_SERVICE_DOWN = (
    "No payment was made: the bank's payment approval service could not be reached. This is temporary. "
    "Tell the customer to try again in a few minutes; do not retry in this turn."
)
PAYMENT_APPROVAL_STALE = (
    "No payment was made: the approval for this payment expired or no longer matches it. Tell the "
    "customer, and if they still want the payment, call make_payment again to start a fresh approval."
)


def _answer(ctx: Context, key: str) -> dict | None:
    """The customer's answer to `key`, if this call carries one.

    Read off the request, never from a tool argument: the elicitation channel
    is the one path into this tool the model cannot write to, which is what
    makes an answer here evidence of what the customer chose.
    """
    responses = getattr(ctx, "input_responses", None) or {}
    response = responses.get(key)
    if response is None:
        return None
    return {"action": getattr(response, "action", None), "content": getattr(response, "content", None)}


def _stage(ctx: Context) -> dict:
    """Which question is outstanding, from the echoed requestState.

    Sealed and bound by the SDK to this tool, these arguments and this
    principal, so it cannot be edited, replayed onto another payment, or lifted
    from another customer's call. The `stage` inside is ours: the SDK pins
    which REQUEST an answer belongs to, not which of our questions.
    """
    state = getattr(ctx, "request_state", None)
    if not isinstance(state, str) or not state:
        return {}
    try:
        parsed = json.loads(state)
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _identity() -> tuple[str, str, str, str, list[str]]:
    token = get_access_token()
    if token is None or not token.subject:
        raise SessionKeyError("No authenticated subject on this request.")
    claims = getattr(token, "claims", None) or {}
    actor = (claims.get("act") or {}).get("sub") or "-"
    client_id = claims.get("azp") or token.client_id or ""
    # The step-up identifies the customer to ThunderID by username, and this is
    # the only trustworthy source for it.
    username = claims.get("username") or claims.get("email") or ""
    return token.subject, actor, client_id, username, list(token.scopes or [])


def _step_up_form(round_, *, payee: str, amount: str, state: dict) -> InputRequiredResult:
    """Ask the customer to prove they are here.

    Deliberately says what the confirmation will be for without yet showing the
    details: enough that the customer knows why they are being asked, not
    enough to tell a stolen session what is about to move.
    """
    if round_.mode == "passkey":
        schema = {
            "type": "object",
            "properties": {
                PASSKEY_CHALLENGE_KEY: {
                    "type": "string",
                    "title": "Confirm it's you",
                    "description": "Use your fingerprint, face or screen lock when your device asks.",
                    "default": round_.passkey_challenge,
                },
                PASSKEY_RESPONSE_KEY: {
                    "type": "string",
                    "title": "Device confirmation",
                    "description": "Your browser fills this in for you.",
                },
            },
            "required": [PASSKEY_RESPONSE_KEY],
        }
        message = f"Please confirm it's you to pay {amount} to {payee}."
    else:
        schema = {
            "type": "object",
            "properties": {
                "password": {
                    "type": "string",
                    "title": "Password",
                    "description": "For your security, we ask for your password before every payment.",
                },
            },
            "required": ["password"],
        }
        message = f"Please enter your password to pay {amount} to {payee}."

    return InputRequiredResult(
        input_requests={STEP_UP_KEY: ElicitRequest(params=ElicitRequestFormParams(
            message=message, requested_schema=schema))},
        request_state=json.dumps(state),
    )


def _account_label(account: dict) -> str:
    """How one funding account reads on the approval card: name, then balance."""
    name = account.get("name") or "Account"
    balance = account.get("balance")
    if not isinstance(balance, int | float):
        return name
    currency = account.get("currency")
    shown = f"{currency} {balance:,.2f}" if currency else f"{balance:,.2f}"
    return f"{name} (balance {shown})"


def _authorization_form(
    *, payee: str, amount: str, reason: str, accounts: list[dict], state: dict
) -> InputRequiredResult:
    """The payment itself, stated in full, for the customer to approve.

    Everything they are agreeing to is on this one card -- who is paid, from
    where, how much, what for. The funding account is a choice here rather than
    a tool argument for the same reason the amount is shown rather than
    summarised: this is the screen the customer is accountable to.
    """
    properties: dict = {
        "beneficiary": {"type": "string", "title": "Pay to", "default": payee},
        "amount_due": {"type": "string", "title": "Amount", "default": amount},
    }
    if reason:
        properties["reason"] = {"type": "string", "title": "Payment for", "default": reason}
    properties["accountId"] = {
        "type": "string",
        "title": "Pay from",
        # "id: label" entries joined by " · " -- the portal splits on exactly
        # that to build the account choices, so only the label is wording.
        "description": " · ".join(
            f"{a.get('id')}: {_account_label(a)}" for a in accounts
        ) or "The account this payment will be taken from.",
        "default": accounts[0]["id"] if accounts else "",
    }
    properties["approve"] = {
        "type": "boolean",
        "title": f"Pay {amount} to {payee}",
        "description": "This approves this one payment only.",
        "default": True,
    }
    return InputRequiredResult(
        input_requests={AUTHORIZATION_KEY: ElicitRequest(params=ElicitRequestFormParams(
            message=f"Please check the details and approve this payment of {amount} to {payee}.",
            requested_schema={"type": "object", "properties": properties,
                              "required": ["approve", "accountId"]}))},
        request_state=json.dumps(state),
    )


async def _bank_token(
    *, settings: Settings, actor_chain: ActorChain, ctx: Context, scope: str
) -> BankToken | str:
    """A bank token for `scope`, carrying the full delegation chain.

    Not cached: a payment token is spent once, and reusing one would hand a
    second payment an authorisation the customer granted to the first.
    """
    actor_token = None
    agent_token = agent_actor_token(ctx)
    if agent_token:
        try:
            actor_token = await actor_chain.actor_token_for(agent_token)
        except ActorChainError as exc:
            logger.warning("Proceeding without the agent in the act chain: %s", exc)
    try:
        exchanged = await exchange_for_bank_token(
            token_endpoint=settings.outbound.oauth.token_endpoint,
            client_id=settings.outbound.oauth.client_id,
            client_secret=settings.outbound.oauth.client_secret.get_secret_value(),
            subject_token=get_access_token().token,  # type: ignore[union-attr]
            audience=settings.outbound.oauth.audience,
            scope=scope,
            actor_token=actor_token,
        )
    except BankTokenExchangeError as exc:
        logger.warning("Bank token exchange failed: %s", exc)
        return messages.BANK_ACCESS_FAILED
    return BankToken(
        access_token=exchanged.access_token, token_type="Bearer",
        expires_at=exchanged.expires_at, scope=exchanged.scope,
    )


async def _payment_token(*, settings: Settings, actor_chain: ActorChain, ctx: Context, requirement):
    return await _bank_token(
        settings=settings, actor_chain=actor_chain, ctx=ctx, scope=requirement.bank_scope
    )


async def _fundable_accounts(
    *, settings: Settings, actor_chain: ActorChain, ctx: Context, token_cache: BankTokenCache, key: str
) -> list[dict]:
    """The accounts the customer could pay from, for the approval card.

    Read with a token scoped to reading accounts, not to paying: the customer is
    choosing, and showing them the choice must not need the permission that
    spends it. Best effort -- a failure here costs the balances on the card, not
    the payment, so the card is still shown without them.
    """
    from ai_banking_mcp_server.outbound.accounts import fetch_accounts

    token = await _bank_token(
        settings=settings, actor_chain=actor_chain, ctx=ctx,
        scope="apex:bank:accounts:read apex:bank:accounts:balances:read",
    )
    if isinstance(token, str):
        logger.info("Showing the payment approval without balances: %s", token)
        return []
    try:
        return await fetch_accounts(
            base_url=str(settings.outbound.api.base_url),
            verify_tls=settings.outbound.api.verify_tls,
            bank_token=token,
        )
    except BankApiError as exc:
        logger.info("Showing the payment approval without balances: %s", exc)
        return []


async def _saved_payee(*, settings: Settings, actor_chain: ActorChain, ctx: Context, name: str) -> dict:
    """The saved payee called `name`, for the consent record.

    Best effort, like the funding accounts: without it the consent still names
    the payee, it just cannot show their account number and bank.
    """
    from ai_banking_mcp_server.outbound.payees import fetch_payees

    token = await _bank_token(settings=settings, actor_chain=actor_chain, ctx=ctx, scope="apex:bank:payees:read")
    if isinstance(token, str):
        logger.info("Recording the payment consent without payee details: %s", token)
        return {}
    try:
        payees = await fetch_payees(
            base_url=str(settings.outbound.api.base_url),
            verify_tls=settings.outbound.api.verify_tls,
            bank_token=token,
        )
    except BankApiError as exc:
        logger.info("Recording the payment consent without payee details: %s", exc)
        return {}
    wanted = name.strip().casefold()
    return next((p for p in payees if str(p.get("name", "")).strip().casefold() == wanted), {})


# A currency marker the customer may have typed around the number: a symbol
# or an ISO code, on either side. Nothing else is stripped.
_CURRENCY_MARK = re.compile(r"^\s*(?:[$£€]|USD|EUR|GBP)?\s*(.*?)\s*(?:USD|EUR|GBP)?\s*$", re.IGNORECASE)
_PLAIN_AMOUNT = re.compile(r"^\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?$|^\d+(?:\.\d{1,2})?$")


def normalise_amount(amount: str) -> str | None:
    """`$1,250.5` -> `1250.50`; None when it is not unambiguously an amount.

    The model passes the amount as the customer said it, so "$100" arrived
    here and went on to the bank, which parses a number: NaN, and a 400 after
    the customer had already approved. Normalised once, on entry, so the
    consent, the approval prompt and the bank call all carry the same value.

    Strict on purpose. Money is never rounded (`10.005` is refused, not paid
    as 10.01), and anything else -- words, ranges, a negative -- is refused
    rather than guessed at.
    """
    match = _CURRENCY_MARK.match(amount or "")
    body = match.group(1) if match else ""
    if not _PLAIN_AMOUNT.match(body):
        return None
    try:
        value = Decimal(body.replace(",", ""))
    except InvalidOperation:
        return None
    if value <= 0:
        return None
    return f"{value:.2f}"


def register(
    mcp: MCPServer,
    *,
    settings: Settings,
    consent_client: ConsentClient,
    token_cache: BankTokenCache,
    locks: SessionLocks,
    actor_chain: ActorChain,
) -> None:
    step_up_client = StepUpClient(
        base_url=str(settings.stepup.base_url),
        application_id=settings.stepup.application_id,
        flow_secret=settings.stepup.flow_secret.get_secret_value(),
    )

    @mcp.tool(
        title="Make a payment",
        annotations=ToolAnnotations(
            read_only_hint=False, destructive_hint=True, idempotent_hint=False, open_world_hint=True
        ),
    )
    async def make_payment(
        ctx: Context,
        payee: Annotated[str, Field(
            description=(
                'The `name` of a saved payee, exactly as returned by get_payees, for example "Dana Lee".'
            ),
        )],
        amount: Annotated[str, Field(
            description=(
                'The amount to pay as a plain positive number with at most two decimal places, for example '
                '"100" or "1250.50". A leading currency symbol or code and thousands separators are accepted '
                "and removed. The amount is never converted or rounded."
            ),
        )],
        reason: Annotated[str, Field(
            description=(
                'A short statement of what the payment is for, for example "Rent" or "Dinner last week". '
                "Pass it whenever the customer has said what the payment is for: it is shown on the approval "
                "they sign and written onto their statement, so omitting it means they approve a payment with "
                "no stated purpose. Leave it empty when they have not said; never invent one."
            ),
        )] = "",
    ) -> dict | str | InputRequiredResult:
        """Send money from the customer's account to one of their saved payees.

        Moves real money and cannot be undone. Each call is exactly one
        payment, so a repeated call is a second payment, not a retry.

        Before anything is paid, the customer confirms their identity (passkey
        or password) and then approves the payee, amount, reason and the
        account to pay from. The funding account is chosen by the customer
        during that approval, so it is not a parameter. Every payment needs its
        own approval; an earlier approval never covers another payment. Both
        steps happen outside this conversation, and only the outcome is
        returned.

        On success, returns the bank's payment record: `paymentId`, `status`,
        `payee`, `amount`, `reference`, `debtorAccount` (the account paid
        from), `balanceAfter`, `currency` and `executedAt`. Otherwise returns a
        message stating whether a payment was made and what to do next.
        """
        if not payee or not amount:
            return (
                "No payment was made: both payee and amount are required. Ask the customer for "
                "whichever is missing, then call make_payment again."
            )
        normalised = normalise_amount(amount)
        if normalised is None:
            return (
                f"No payment was made: '{amount}' is not a valid amount. Pass a positive number with at "
                'most two decimal places, such as "100" or "1250.50". If you are unsure what the customer '
                "meant, ask them."
            )
        amount = normalised
        try:
            key = session_key(ctx)
            subject, actor, client_id, username, scopes = _identity()
        except SessionKeyError as exc:
            logger.warning("Refusing make_payment: %s", exc)
            return messages.NO_SESSION

        requirement = CATALOG[MAKE_PAYMENT]
        if requirement.mcp_scope and requirement.mcp_scope not in scopes:
            logger.warning("Refusing make_payment: token lacks %s", requirement.mcp_scope)
            return messages.missing_scope(requirement.mcp_scope)
        if not username:
            # Without it the step-up cannot name whose authentication counts,
            # and guessing would be the whole vulnerability.
            logger.warning("Refusing make_payment: token carries no username claim")
            return (
                "No payment was made: this sign-in cannot be used to confirm the customer's identity. "
                "Do not retry. Tell the customer to sign out, sign in again, and then ask for the payment again."
            )

        stage = _stage(ctx)
        async with locks.for_session(key):
            # ---------------------------------------------------------- round 1
            if not stage:
                try:
                    round_ = await step_up_client.begin(username)
                except StepUpError as exc:
                    logger.warning("Could not start the payment step-up: %s", exc)
                    return (
                        "No payment was made: identity confirmation could not be started because of a "
                        "temporary problem. Tell the customer, and call make_payment again only if they ask to retry."
                    )
                if round_.mode == "password" and settings.stepup.require_passkey:
                    return PASSKEY_REQUIRED
                logger.info("Payment step-up started (mode=%s payee=%s)", round_.mode, payee)
                return _step_up_form(round_, payee=payee, amount=amount, state={
                    "stage": "stepup", "mode": round_.mode,
                    "exec": round_.state.execution_id, "chal": round_.state.challenge_token,
                })

            # ---------------------------------------------------------- round 2
            if stage.get("stage") == "stepup":
                answer = _answer(ctx, STEP_UP_KEY)
                if answer is None:
                    return (
                        "No payment was made yet: the customer has not finished confirming their identity. "
                        "Wait for them to finish; do not call make_payment again in the meantime."
                    )
                if answer.get("action") != "accept":
                    audit.info("DECLINED payment step-up subject=%s payee=%s", subject, payee)
                    return PAYMENT_DECLINED
                content = answer.get("content") or {}
                state = StepUpState(execution_id=stage.get("exec", ""), challenge_token=stage.get("chal", ""))

                if stage.get("mode") == "passkey":
                    signed = content.get(PASSKEY_RESPONSE_KEY)
                    if not signed:
                        return (
                        "No payment was made: the confirmation from the customer's device did not arrive. "
                        "Tell them it did not go through, and call make_payment again only if they ask to retry."
                    )
                    try:
                        inputs = json.loads(signed)
                    except ValueError:
                        return (
                            "No payment was made: the confirmation from the customer's device could not be read. "
                            "Tell them it did not go through, and call make_payment again only if they ask to retry."
                        )
                    action_id = None
                else:
                    password = content.get("password")
                    if not password:
                        return (
                            "No payment was made: the customer did not enter their password. Tell them a payment "
                            "needs it, and call make_payment again only if they ask to retry."
                        )
                    inputs = {"username": username, "password": password}
                    action_id = "action_password"

                try:
                    round_ = await step_up_client.submit(state, inputs, action_id=action_id)
                except StepUpError as exc:
                    logger.warning("Payment step-up failed: %s", exc)
                    return (
                        "No payment was made: the customer's identity could not be confirmed (for example, a "
                        "wrong password or a cancelled device prompt). Tell them, and call make_payment again "
                        "only if they ask to retry."
                    )

                if round_.mode != "complete":
                    # The passkey did not satisfy it, so the flow is now asking
                    # for a password instead. Same question, next round.
                    logger.info("Payment step-up continuing (mode=%s)", round_.mode)
                    if round_.mode == "password" and settings.stepup.require_passkey:
                        return PASSKEY_REQUIRED
                    return _step_up_form(round_, payee=payee, amount=amount, state={
                        "stage": "stepup", "mode": round_.mode,
                        "exec": round_.state.execution_id, "chal": round_.state.challenge_token,
                    })

                assertion = round_.assertion or ""
                if assertion_subject(assertion) != subject:
                    # Somebody authenticated, but not the customer this call is
                    # for. Nothing about that is recoverable.
                    audit.warning(
                        "REJECTED payment step-up: assertion subject=%s does not match token subject=%s",
                        assertion_subject(assertion), subject,
                    )
                    return (
                        "No payment was made: the identity confirmed belongs to someone other than the signed-in "
                        "customer. Do not retry. Tell the customer the confirmation did not match their sign-in."
                    )
                used = authenticators(assertion)
                step_up_label = ",".join(used) if used else "passkey"
                if settings.stepup.require_passkey and "CredentialsAuthenticator" in used:
                    return PASSKEY_REQUIRED
                audit.info(
                    "STEP-UP OK subject=%s payee=%s amount=%s via=%s", subject, payee, amount, step_up_label
                )

                saved_payee = await _saved_payee(
                    settings=settings, actor_chain=actor_chain, ctx=ctx, name=payee
                )
                try:
                    created = await consent_client.create_payment(
                        subject=subject, actor=actor, client_id=client_id,
                        payee=payee, amount=amount, reference=reason, step_up=step_up_label,
                        payee_account_number=str(saved_payee.get("accountNumber") or ""),
                        payee_bank=str(saved_payee.get("bank") or ""),
                        currency=str(saved_payee.get("currency") or ""),
                        purpose_id=settings.outbound.consent.payment_purpose_id,
                        purpose_name=settings.outbound.consent.payment_purpose_name,
                        element_namespace=settings.outbound.consent.element_namespace,
                        validity_seconds=settings.outbound.consent.payment_validity_seconds,
                    )
                except ConsentServiceError as exc:
                    logger.warning("Could not create the payment authorization: %s", exc)
                    return PAYMENT_SERVICE_DOWN

                accounts = await _fundable_accounts(
                    settings=settings, actor_chain=actor_chain, ctx=ctx, token_cache=token_cache, key=key
                )
                logger.info("Requesting payment authorization (id=%s payee=%s)", created.consent_id, payee)
                return _authorization_form(
                    payee=payee, amount=amount, reason=reason, accounts=accounts,
                    state={"stage": "confirm", "consent": created.consent_id, "stepUp": step_up_label},
                )

            # ---------------------------------------------------------- round 3
            if stage.get("stage") != "confirm":
                return PAYMENT_APPROVAL_STALE

            answer = _answer(ctx, AUTHORIZATION_KEY)
            if answer is None:
                return (
                    "No payment was made yet: the customer has not answered the payment approval. "
                    "Wait for them; do not call make_payment again in the meantime."
                )
            consent_id = stage.get("consent")
            if not consent_id:
                return PAYMENT_APPROVAL_STALE
            try:
                record = await consent_client.get(consent_id)
                if record.subject != subject or record.actor != actor:
                    audit.warning(
                        "REJECTED payment consent=%s: answer from subject=%s actor=%s does not own it",
                        consent_id, subject, actor,
                    )
                    return (
                        "No payment was made: the approval sent with this request belongs to a different "
                        "session and was rejected. Do not retry. Tell the customer to ask for the payment again."
                    )
                if answer.get("action") != "accept":
                    audit.info("DECLINED payment consent=%s subject=%s", consent_id, subject)
                    return PAYMENT_DECLINED
                content = answer.get("content") or {}
                if content.get("approve") is False:
                    audit.info("DECLINED payment consent=%s subject=%s", consent_id, subject)
                    return PAYMENT_DECLINED
                account_id = content.get("accountId")
                if not account_id:
                    return (
                        "No payment was made: the customer approved without choosing an account to pay from. "
                        "Tell them, and if they still want the payment, call make_payment again so they can pick "
                        "an account on a new approval card."
                    )
                funding = await _fundable_accounts(
                    settings=settings, actor_chain=actor_chain, ctx=ctx, token_cache=token_cache, key=key
                )
                await consent_client.approve(
                    consent_id=consent_id, user_id=subject, account_id=str(account_id),
                    account=next((a for a in funding if str(a.get("id")) == str(account_id)), None),
                )
                audit.info(
                    "APPROVED payment consent=%s subject=%s actor=%s account=%s payee=%s amount=%s via=%s",
                    consent_id, subject, actor, account_id, payee, amount, stage.get("stepUp"),
                )
            except ConsentServiceError as exc:
                logger.warning("Consent service unavailable: %s", exc)
                return PAYMENT_SERVICE_DOWN

            bank_token = await _payment_token(
                settings=settings, actor_chain=actor_chain, ctx=ctx, requirement=requirement
            )
            if isinstance(bank_token, str):
                return (
                    "No payment was made: the bank did not grant access to make it. Tell the customer to try "
                    "again shortly; do not retry in this turn."
                )

        try:
            result = await execute_payment(
                base_url=str(settings.outbound.api.base_url),
                verify_tls=settings.outbound.api.verify_tls,
                payee=payee, amount=amount, debtor_account=str(account_id),
                reference=reason, bank_token=bank_token,
            )
        except BankApiError as exc:
            logger.warning("Payment call failed: %s", exc)
            if exc.status == 409:
                return (
                    "No new payment was made: this approval had already been used, so the payment may already "
                    "have gone through. Do not call make_payment again. Tell the customer it may already have "
                    "been paid and suggest they check their recent transactions before asking again."
                )
            if exc.status == 422:
                return (
                    f"No payment was made: the chosen account does not have enough money for {amount}. "
                    "Tell the customer; if they want, call make_payment again so they can pick another "
                    "account or pay a smaller amount."
                )
            if exc.status in (400, 401, 403, 404):
                return (
                    "No payment was made: the bank rejected the request. Do not retry with the same details. "
                    "Tell the customer the payment did not go through."
                )
            return (
                "The bank did not confirm this payment, so whether it went through is unknown. Do not call "
                "make_payment again: a retry could pay twice. Tell the customer, and suggest checking their "
                "recent transactions before trying again."
            )
        audit.info("EXECUTED payment consent=%s payee=%s amount=%s account=%s",
                   consent_id, payee, amount, account_id)
        # The authorisation has now been spent. Retiring it is what stops a
        # used approval sitting ACTIVE in the customer's consent portal, where
        # it reads as a standing permission they never granted.
        await consent_client.revoke(str(consent_id), user_id=subject)
        return result
