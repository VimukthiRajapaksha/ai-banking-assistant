"""The consent check every data tool runs before it touches the bank.

Extracted so each tool states only what it needs -- its catalog entry -- and
the rules about who may grant what live in exactly one place.

The contract: return a `Gate` carrying a usable bank token, or an
`InputRequiredResult` asking the user for consent, or a plain string explaining
why the call cannot proceed. Tools never decide consent themselves.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver import Context
from mcp.types import ElicitRequest, ElicitRequestFormParams, InputRequiredResult

from ai_banking_mcp_server.outbound.actor_chain import ActorChain, ActorChainError
from ai_banking_mcp_server.outbound.consent import ConsentClient, ConsentServiceError
from ai_banking_mcp_server.outbound.oauth import BankToken
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
from ai_banking_mcp_server.tools.catalog import (
    CATALOG,
    clamp_to_token_scopes,
    permissions_for,
    plan_permissions,
)

logger = logging.getLogger(__name__)

#: Consent decisions are logged apart from ordinary tool activity. Once this
#: server records approvals, this line is the only evidence distinguishing an
#: answer the customer gave from a relay that invented one, so it must be
#: findable without reading around it.
audit = logging.getLogger("ai_banking_mcp_server.audit")

ELICITATION_KEY = "account_access_consent"

#: Reserved property key carrying the limits on the grant as a whole rather
#: than a permission within it. A root-level `description` would be the
#: natural home, but only `properties` survives the wire -- everything else on
#: the schema object is normalised away -- so the limits travel as a named
#: property the frontend lifts out instead of rendering as a permission.
GRANT_LIMITS_KEY = "grant_limits"

#: Plain language, and phrased as the data itself rather than as an action the
#: system performs -- a permission list the user cannot read is one they cannot
#: meaningfully refuse. Declaration order is display order: what an account is,
#: then what is in it, then what has happened to it.
PERMISSION_LABELS = {
    "ReadAccountsDetail": "Your account names and types",
    "ReadBalances": "Your current balances",
    "ReadTransactionsDetail": "Your transaction history",
}


def _heading(permissions: frozenset[str]) -> str:
    """The one sentence the user is actually being asked.

    Names what is being read rather than "your account information", which
    covers everything the bank holds and so tells the user nothing.
    """
    if "ReadTransactionsDetail" in permissions:
        return "Allow the assistant to view your accounts and transactions?"
    return "Allow the assistant to view your accounts?"


def _duration(validity_seconds: int) -> str:
    """How long the grant lasts, in words a person would use.

    Counted rather than interpolated: the old text read "1 hour(s)", which is
    a plural the code declined to solve and the kind of detail that tells a
    careful reader nobody proof-read the screen.
    """
    if validity_seconds < 3600:
        minutes = max(1, round(validity_seconds / 60))
        return f"Access ends after {minutes} minute{'' if minutes == 1 else 's'}"
    hours = round(validity_seconds / 3600)
    return f"Access ends after {hours} hour{'' if hours == 1 else 's'}"


@dataclass
class Gate:
    """Cleared to proceed: the caller may use `bank_token`."""

    bank_token: BankToken
    session_key: str


def _identity() -> tuple[str, str, list[str]]:
    token = get_access_token()
    if token is None or not token.subject:
        raise SessionKeyError("No authenticated subject on this request.")
    claims = getattr(token, "claims", None) or {}
    actor = (claims.get("act") or {}).get("sub") or "-"
    return token.subject, actor, list(token.scopes or [])


#: Header the agent forwards its own token on, so this server can put the agent
#: into the bank-facing `act` chain. See outbound/actor_chain.py for why a token
#: issued to the agent is the only input that produces `act.act`.
AGENT_ACTOR_HEADER = "x-agent-actor-token"


def agent_actor_token(ctx: Context) -> str | None:
    """The agent's own token, if the caller forwarded one.

    Read off the HTTP request rather than the tool arguments or `meta`: it is a
    credential, and nothing the model produces may reach it. Absent for a
    direct MCP client with no agent in front, which is allowed -- the chain
    then records one less hop rather than failing.
    """
    request = getattr(getattr(ctx, "request_context", None), "request", None)
    headers = getattr(request, "headers", None)
    if headers is None:
        return None
    return headers.get(AGENT_ACTOR_HEADER) or None


def planned_tools(ctx: Context) -> list[str]:
    """Tools the agent says it expects to use this turn, if it said.

    Advisory only. Never trusted for anything restricted -- the agent is
    exactly the component a prompt injection compromises.
    """
    request_context = getattr(ctx, "request_context", None)
    meta = getattr(request_context, "meta", None)
    if meta is None:
        return []
    planned = meta.get("planned_tools") if isinstance(meta, dict) else getattr(meta, "planned_tools", None)
    return [t for t in (planned or []) if isinstance(t, str)]


def answered(ctx: Context, key: str) -> str | None:
    """The action the customer chose, if this call carries their answer.

    Read straight off the request rather than from anything the model
    produced: the elicitation never enters the model's context, and the tool
    functions have no parameter that reaches it.
    """
    responses = getattr(ctx, "input_responses", None) or {}
    answer = responses.get(key)
    return getattr(answer, "action", None) if answer is not None else None


#: Prefix on the requestState payload, so a value from some other round is
#: recognisably not one of ours rather than parsed as an id.
_STATE_PREFIX = "consent:"


def pending_consent_id(ctx: Context) -> str | None:
    """The consent this round is answering, from the echoed requestState.

    The SDK seals requestState (AES-256-GCM) and binds it to the tool, its
    arguments and the caller, so the id inside is unreadable and unforgeable by
    the client and cannot be replayed onto another request. That is what makes
    it a safe place to carry it -- and why there is no server-side store: a
    store keyed by anything the server knows is shared across a customer's
    concurrent conversations, and one answer then approves another's request.
    """
    state = getattr(ctx, "request_state", None)
    if isinstance(state, str) and state.startswith(_STATE_PREFIX):
        return state[len(_STATE_PREFIX):] or None
    return None


def consent_form(
    permissions: frozenset[str], validity_seconds: int, consent_id: str
) -> InputRequiredResult:
    """The form the user answers in the chat.

    The consent id is deliberately not sent: `request_state` reaches clients as
    an SDK-managed opaque token, elicitation `_meta` is stripped on the wire,
    and unknown JSON Schema keywords are normalised away. The frontend looks up
    the user's own pending consent instead -- which is the more honest model,
    since it is the user's record to find and approve.
    """
    # One property per permission, rather than one string listing them all.
    # Joined into a sentence they read as a single phrase, which is the one
    # thing on this card the user most needs to be able to check item by item.
    granted = {
        name: {"type": "boolean", "title": label, "default": True}
        for name, label in PERMISSION_LABELS.items()
        if name in permissions
    }
    # Anything the catalog knows about but this map doesn't still has to be
    # shown -- an unnamed permission must never be granted silently.
    granted.update(
        {name: {"type": "boolean", "title": name, "default": True}
         for name in sorted(permissions) if name not in PERMISSION_LABELS}
    )

    granted[GRANT_LIMITS_KEY] = {
        "type": "string",
        "title": f"{_duration(validity_seconds)} · You can withdraw it at any time",
    }

    return InputRequiredResult(
        input_requests={
            ELICITATION_KEY: ElicitRequest(
                params=ElicitRequestFormParams(
                    message=_heading(permissions),
                    requested_schema={
                        "type": "object",
                        "properties": granted,
                        "required": [],
                    },
                )
            )
        },
        request_state=f"{_STATE_PREFIX}{consent_id}",
    )


async def _mint(
    requirement,
    *,
    key: str,
    settings: Settings,
    token_cache: BankTokenCache,
    actor_chain: ActorChain,
    agent_token: str | None,
) -> Gate | str:
    """A bank token for this tool's scope, minted or reused.

    Cached per (session, scope-set): a token minted for balances must not be
    reused for transaction history.
    """
    cache_key = f"{key}|{requirement.bank_scope}"
    bank_token = token_cache.get(cache_key)
    if bank_token is None:
        # This server, recorded as acting for the agent. Failing to build it is
        # not fatal: the bank token is still correct, it just records one hop
        # less, and refusing the customer's request over a weaker audit record
        # would be the wrong trade.
        actor_token = None
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
                scope=requirement.bank_scope,
                actor_token=actor_token,
            )
        except BankTokenExchangeError as exc:
            logger.warning("Bank token exchange failed: %s", exc)
            return messages.BANK_ACCESS_FAILED
        bank_token = BankToken(
            access_token=exchanged.access_token,
            token_type="Bearer",
            expires_at=exchanged.expires_at,
            scope=exchanged.scope,
        )
        token_cache.set(cache_key, bank_token)
    return Gate(bank_token=bank_token, session_key=cache_key)


async def clear(
    ctx: Context,
    tool: str,
    *,
    settings: Settings,
    consent_client: ConsentClient,
    token_cache: BankTokenCache,
    locks: SessionLocks,
    actor_chain: ActorChain,
) -> Gate | InputRequiredResult | str:
    """Check scope and consent for `tool`, and mint a narrowly scoped bank token."""
    try:
        key = session_key(ctx)
        subject, actor, scopes = _identity()
    except SessionKeyError as exc:
        logger.warning("Refusing %s: %s", tool, exc)
        return messages.NO_SESSION

    requirement = CATALOG[tool]
    required = permissions_for(tool)
    if requirement.mcp_scope and requirement.mcp_scope not in scopes:
        logger.warning("Refusing %s: token lacks %s", tool, requirement.mcp_scope)
        return messages.missing_scope(requirement.mcp_scope)

    async with locks.for_session(key):
        try:
            # A tool that needs no permissions needs no consent -- the token's
            # scope is the whole authorisation. Checked before anything else,
            # so such a tool never creates a consent record nor asks.
            if not required:
                return await _mint(
                    requirement, key=key, settings=settings, token_cache=token_cache,
                    actor_chain=actor_chain, agent_token=agent_actor_token(ctx),
                )

            # The customer's answer, if this retry carries one. Applied before
            # looking for an active consent, because applying it is what makes
            # one active.
            action = answered(ctx, ELICITATION_KEY)
            if action is not None:
                consent_id = pending_consent_id(ctx)
                if consent_id is None:
                    logger.warning("Consent answer for %s carried no pending consent", tool)
                    return messages.STALE_APPROVAL
                # The id came back inside a sealed, request-bound requestState,
                # so it cannot have been read, altered or moved here from
                # another request. Ownership is re-checked against the consent
                # itself regardless: this is the call that grants access.
                record = await consent_client.get(consent_id)
                if record.subject != subject or record.actor != actor:
                    audit.warning(
                        "REJECTED consent=%s: answer from subject=%s actor=%s does not own it",
                        consent_id, subject, actor,
                    )
                    return messages.FOREIGN_APPROVAL
                if action != "accept":
                    audit.info("DECLINED consent=%s subject=%s actor=%s", consent_id, subject, actor)
                    return messages.ACCESS_DECLINED
                await consent_client.approve(consent_id=consent_id, user_id=subject)
                audit.info(
                    "APPROVED consent=%s subject=%s actor=%s tool=%s", consent_id, subject, actor, tool
                )

            consent = await consent_client.find_active(subject=subject, actor=actor)
            if consent is None or not required <= consent.permissions:
                # The invoked tool's own permissions always count -- it is
                # actually being called. A declared plan may only widen this by
                # non-restricted permissions, and never past the token's scopes.
                requested = clamp_to_token_scopes(
                    required | plan_permissions(planned_tools(ctx)), scopes
                )
                created = await consent_client.create(
                    consent_type="account-information",
                    subject=subject,
                    actor=actor,
                    permissions=requested,
                    purpose_id=settings.outbound.consent.account_access_purpose_id,
                    purpose_name=settings.outbound.consent.account_access_purpose_name,
                    element_namespace=settings.outbound.consent.element_namespace,
                    validity_seconds=settings.outbound.consent.validity_seconds,
                )
                logger.info(
                    "Requesting consent for %s (id=%s permissions=%s)",
                    tool, created.consent_id, " ".join(sorted(requested)),
                )
                return consent_form(
                    requested, settings.outbound.consent.validity_seconds, created.consent_id
                )

            if not await consent_client.validate(
                consent_id=consent.consent_id, subject=subject, permissions=required
            ):
                return (
                    "The bank rejected the customer's existing approval for account access (it may have "
                    "expired or been withdrawn), so nothing was accessed. Do not retry in this turn. "
                    "Tell the customer and suggest they try again in a moment."
                )
        except ConsentServiceError as exc:
            logger.warning("Consent service unavailable: %s", exc)
            return messages.CONSENT_SERVICE_DOWN

        return await _mint(
            requirement, key=key, settings=settings, token_cache=token_cache,
            actor_chain=actor_chain, agent_token=agent_actor_token(ctx),
        )
