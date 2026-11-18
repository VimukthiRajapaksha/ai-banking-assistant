"""Client for the consent store: the Consent Management API v2 of Asgardeo or
WSO2 Identity Server (7.3+). Both expose the same API under
`<base>/api/identity/consent-mgt/v2.0`.

This server CREATES consents, READS them, and VALIDATES them before acting. It
also records the customer's answer from the chat (`approve`): the agent relays
that answer but never decides it, and the authorizer written is always the
subject of this server's own verified token. The customer's consent portal
reads the same records and can approve, reject or revoke them too.

Consent lifecycle: PENDING (one authorizer, the customer) -> ACTIVE (the
authorization APPROVED) -> EXPIRED / REVOKED / REJECTED.

Behaviour of the API this client is written around (observed, not all in the
spec -- platform/consent/asgardeo/README.md):

* `language` is mandatory in practice: without it creation fails with 500.
* A new consent for the same (subject, service, purpose) revokes the previous
  one, even an ACTIVE one. `serviceId` is the agent, so a customer holds one
  live consent per agent and purpose.
* Nothing guards state transitions, so `approve` checks for PENDING itself.
* A PATCH of `properties` replaces the whole map: read, merge, then write.
* Creation answers with the id only, and list rows carry no elements, so the
  record is read back with GET.
* `POST /consents/{id}/revoke` with no body is refused with 411.
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

STATE_PENDING = "PENDING"
STATE_ACTIVE = "ACTIVE"

#: The one element a payment consent grants.
PAYMENT_ELEMENT = "InitiatePayment"

#: Properties written on each consent. The consent portal reads these names
#: (apps/consent-portal/src/lib/consent/model.ts), so they are a contract.
PROP_SUBJECT = "subject"
PROP_AGENT_ID = "agentId"
PROP_AGENT_NAME = "agentName"
PROP_APPLICATION_ID = "applicationId"
PROP_APPLICATION_NAME = "applicationName"
PROP_PAYEE = "payee"
#: Where the money goes, as the customer's consent portal shows it. Recorded
#: with the consent so the record states the whole payment, not just a name.
PROP_PAYEE_ACCOUNT_NUMBER = "payeeAccountNumber"
PROP_PAYEE_BANK = "payeeBank"
PROP_AMOUNT = "amount"
PROP_CURRENCY = "currency"
#: Why the customer said they were paying. Part of what they approved, so it is
#: recorded with the approval rather than only sent to the bank.
PROP_REFERENCE = "reference"
#: How presence was proved for this payment -- the authenticators the step-up
#: assertion named.
PROP_STEPUP = "stepUp"
#: The funding account the customer picked when approving a payment.
PROP_DEBTOR_ACCOUNT_ID = "debtorAccountId"
PROP_DEBTOR_ACCOUNT_NAME = "debtorAccountName"
PROP_DEBTOR_ACCOUNT_NUMBER = "debtorAccountNumber"

#: Renew the store's access token this long before it expires, so a request
#: never sets out with a token about to lapse.
_TOKEN_MARGIN_SECONDS = 60


class ConsentServiceError(Exception):
    """Raised when the consent store cannot be reached or rejects a call."""


def _now_ms() -> int:
    """Wall clock in milliseconds, the unit of every timestamp in the API."""
    return int(time.time() * 1000)


@dataclass
class ConsentRecord:
    consent_id: str
    status: str
    permissions: frozenset[str]
    #: Milliseconds since epoch; 0 when the consent does not expire.
    expiration_time: int
    #: Who the consent is for, and which agent it authorises. Read back from
    #: the record rather than trusted from the caller: this pair is what makes
    #: an approval belong to the customer in front of it.
    subject: str = ""
    actor: str = ""
    #: Only set on an approved payment consent: the funding account the
    #: customer picked when approving.
    debtor_account: str | None = None

    @property
    def active(self) -> bool:
        if self.status != STATE_ACTIVE:
            return False
        return self.expiration_time == 0 or self.expiration_time > _now_ms()


def _permissions_of(payload: dict) -> frozenset[str]:
    """The permissions a consent grants: the elements of its purposes.

    A consent is created with exactly the elements asked for, and approving
    it grants all of them, so every element listed counts once the consent is
    ACTIVE. The state check is the caller's (`ConsentRecord.active`).
    """
    names: set[str] = set()
    for purpose in payload.get("purposes") or []:
        for element in purpose.get("elements") or []:
            if isinstance(element, dict) and element.get("name"):
                names.add(element["name"])
    return frozenset(names)


def _record(payload: dict) -> ConsentRecord:
    properties = payload.get("properties") or {}
    return ConsentRecord(
        consent_id=str(payload.get("id", "")),
        status=str(payload.get("state", "")).upper(),
        permissions=_permissions_of(payload),
        expiration_time=int(payload.get("expiryTime") or 0),
        subject=str(payload.get("subjectId") or ""),
        actor=str(payload.get("serviceId") or ""),
        debtor_account=properties.get(PROP_DEBTOR_ACCOUNT_ID) or None,
    )


class ConsentClient:
    def __init__(
        self,
        *,
        base_url: str,
        token_endpoint: str,
        client_id: str,
        client_secret: str,
        account_access_purpose_id: str,
        payment_purpose_id: str,
        language: str = "en",
        agent_name: str = "",
        application_id: str = "",
        application_name: str = "",
        timeout: float = 10.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._token_endpoint = token_endpoint
        self._client_id = client_id
        self._client_secret = client_secret
        self._account_purpose = account_access_purpose_id
        self._payment_purpose = payment_purpose_id
        self._language = language
        self._agent_name = agent_name
        self._application_id = application_id
        self._application_name = application_name
        self._timeout = timeout
        self._token: str | None = None
        self._token_expires_at = 0.0
        self._token_lock = asyncio.Lock()
        #: Element ids per purpose, by name. Creating a consent names its
        #: elements by id; a purpose's elements only change when it gets a new
        #: version, which needs a new purpose id here anyway.
        self._element_ids: dict[str, dict[str, str]] = {}

    # ------------------------------------------------------------------ transport

    async def _access_token(self, *, force: bool = False) -> str:
        """This server's own token for the consent API (client credentials).

        The grant has no refresh token, so renewing means asking again.
        """
        async with self._token_lock:
            if not force and self._token and time.monotonic() < self._token_expires_at:
                return self._token
            try:
                async with httpx.AsyncClient(timeout=self._timeout) as client:
                    response = await client.post(
                        self._token_endpoint,
                        auth=(self._client_id, self._client_secret),
                        data={
                            "grant_type": "client_credentials",
                            "scope": "internal_consent_mgt_consent_create internal_consent_mgt_consent_view "
                            "internal_consent_mgt_consent_update internal_consent_mgt_purpose_view",
                        },
                    )
            except httpx.HTTPError as exc:
                raise ConsentServiceError(f"consent store token request failed: {exc}") from exc
            if response.status_code != 200:
                # The token endpoint's error body names the problem
                # (invalid_client, invalid_scope) and holds no secret.
                raise ConsentServiceError(
                    f"consent store token request returned {response.status_code}: {response.text[:200]}"
                )
            body = response.json()
            self._token = body["access_token"]
            lifetime = float(body.get("expires_in") or 3600)
            self._token_expires_at = time.monotonic() + max(lifetime - _TOKEN_MARGIN_SECONDS, 0)
            return self._token

    async def _request(self, method: str, path: str, **kwargs) -> dict:
        async def send(token: str) -> httpx.Response:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                return await client.request(
                    method,
                    f"{self._base_url}{path}",
                    headers={"Accept": "application/json", "Authorization": f"Bearer {token}"},
                    **kwargs,
                )

        try:
            response = await send(await self._access_token())
            if response.status_code == 401:
                # Revoked or rotated early: one fresh token, then give up.
                response = await send(await self._access_token(force=True))
        except httpx.HTTPError as exc:
            raise ConsentServiceError(f"{method} {path} failed: {exc}") from exc
        if response.status_code >= 300:
            # Bodies here describe consent state, never credentials, so the
            # status alone would lose the only useful diagnostic.
            raise ConsentServiceError(f"{method} {path} returned {response.status_code}: {response.text[:200]}")
        return response.json() if response.content else {}

    async def _element_ids_of(self, purpose_id: str) -> dict[str, str]:
        if purpose_id not in self._element_ids:
            purpose = await self._request("GET", f"/purposes/{purpose_id}")
            self._element_ids[purpose_id] = {
                e["name"]: e["id"] for e in purpose.get("elements") or [] if e.get("name") and e.get("id")
            }
        return self._element_ids[purpose_id]

    # ------------------------------------------------------------------- writing

    async def _create(
        self, *, subject: str, actor: str, purpose_id: str, elements: frozenset[str],
        validity_seconds: int, properties: dict[str, str],
    ) -> ConsentRecord:
        """Create a PENDING consent the customer is the only authorizer of.

        It grants nothing until that authorization is APPROVED.
        """
        known = await self._element_ids_of(purpose_id)
        missing = sorted(elements - known.keys())
        if missing:
            raise ConsentServiceError(f"purpose {purpose_id} has no elements named {', '.join(missing)}")
        payload = {
            "subjectId": subject,
            "serviceId": actor,
            "language": self._language,
            "purposes": [{"id": purpose_id, "elements": [{"id": known[name]} for name in sorted(elements)]}],
            "expiryTime": _now_ms() + validity_seconds * 1000,
            "authorizations": [{"userId": subject, "type": "USER"}],
            "properties": {k: v for k, v in properties.items() if v},
        }
        created = await self._request("POST", "/consents", json=payload)
        return await self.get(str(created["id"]))

    def _common_properties(self, *, subject: str, actor: str, client_id: str = "") -> dict[str, str]:
        return {
            PROP_SUBJECT: subject,
            PROP_AGENT_ID: actor,
            PROP_AGENT_NAME: self._agent_name,
            PROP_APPLICATION_ID: client_id or self._application_id,
            PROP_APPLICATION_NAME: self._application_name,
        }

    async def create(
        self, *, subject: str, actor: str, permissions: frozenset[str], validity_seconds: int
    ) -> ConsentRecord:
        """Ask for account-information access: one PENDING consent."""
        record = await self._create(
            subject=subject, actor=actor, purpose_id=self._account_purpose, elements=permissions,
            validity_seconds=validity_seconds, properties=self._common_properties(subject=subject, actor=actor),
        )
        logger.info(
            "Consent created (id=%s state=%s permissions=%s)",
            record.consent_id, record.status, " ".join(sorted(record.permissions)),
        )
        return record

    async def create_payment(
        self,
        *,
        subject: str,
        actor: str,
        client_id: str,
        payee: str,
        amount: str,
        reference: str = "",
        step_up: str = "",
        payee_account_number: str = "",
        payee_bank: str = "",
        currency: str = "",
        validity_seconds: int,
    ) -> ConsentRecord:
        """Create a single-use consent for ONE payment.

        Payee and amount are recorded with it, so the payment executed can be
        checked against what the customer actually approved -- dynamic
        linking. Without that, an approval for a small payment could be spent
        on a large one.
        """
        properties = self._common_properties(subject=subject, actor=actor, client_id=client_id) | {
            PROP_PAYEE: payee,
            PROP_PAYEE_ACCOUNT_NUMBER: payee_account_number,
            PROP_PAYEE_BANK: payee_bank,
            PROP_AMOUNT: amount,
            PROP_CURRENCY: currency,
            PROP_REFERENCE: reference,
            PROP_STEPUP: step_up,
        }
        record = await self._create(
            subject=subject, actor=actor, purpose_id=self._payment_purpose,
            elements=frozenset({PAYMENT_ELEMENT}), validity_seconds=validity_seconds, properties=properties,
        )
        logger.info("Payment consent created (id=%s state=%s)", record.consent_id, record.status)
        return record

    async def approve(
        self, *, consent_id: str, user_id: str, account_id: str | None = None, account: dict | None = None
    ) -> None:
        """Record the customer's approval, moving the consent to ACTIVE.

        The customer answers in the chat widget; that answer reaches this
        server through the agent, and this server writes it down. `user_id` is
        the subject from this server's own verified token, not anything the
        caller supplied.

        Only a PENDING consent is approved. The API would also move a REVOKED
        or REJECTED one back to ACTIVE, so the state is checked here.
        """
        current = await self._request("GET", f"/consents/{consent_id}")
        state = str(current.get("state", "")).upper()
        if state == STATE_ACTIVE:
            # Already approved: a retried round, or the portal got there first.
            logger.info("Consent %s is already ACTIVE; nothing to approve", consent_id)
            return
        if state != STATE_PENDING:
            raise ConsentServiceError(f"consent {consent_id} is {state or 'unknown'}, not PENDING")
        body: dict = {"authorizations": [{"userId": user_id, "state": "APPROVED"}]}
        if account_id:
            # A payment approval also records which account it is drawn from:
            # it is part of what the customer approved, not a later choice.
            # The PATCH replaces the whole map, so the current one is merged.
            body["properties"] = dict(current.get("properties") or {}) | {
                k: v
                for k, v in {
                    PROP_DEBTOR_ACCOUNT_ID: account_id,
                    PROP_DEBTOR_ACCOUNT_NAME: str((account or {}).get("name") or ""),
                    PROP_DEBTOR_ACCOUNT_NUMBER: str((account or {}).get("accountNumber") or ""),
                }.items()
                if v
            }
        await self._request("PATCH", f"/consents/{consent_id}", json=body)

    async def revoke(self, consent_id: str, *, user_id: str) -> None:
        """Retire a consent that has been spent.

        A payment consent is single-use, but nothing marks it used -- left
        alone it sits ACTIVE until its expiry, which is how an authorisation
        the customer already spent goes on looking live in their portal.

        Failure is logged and swallowed. This runs AFTER the money has moved,
        so raising here would report a completed payment as failed and invite
        a retry -- the far worse outcome. What is lost is tidiness, not safety:
        the consent expires on its own minutes later.
        """
        try:
            await self._request("POST", f"/consents/{consent_id}/revoke", json={})
            logger.info("Payment consent retired (id=%s, for %s)", consent_id, user_id)
        except ConsentServiceError as exc:
            logger.warning("Could not retire spent consent %s: %s", consent_id, exc)

    # ------------------------------------------------------------------- reading

    async def get(self, consent_id: str) -> ConsentRecord:
        return _record(await self._request("GET", f"/consents/{consent_id}"))

    async def find_active(self, *, subject: str, actor: str) -> ConsentRecord | None:
        """This customer's live ACCOUNT-INFORMATION consent for this agent.

        Searched by identity rather than by id because the caller has an
        identity, not a consent handle. The purpose filter is load-bearing: a
        customer also holds payment consents, which grant none of the account
        permissions.
        """
        try:
            body = await self._request(
                "GET",
                "/consents",
                params={
                    "userId": subject,
                    "relation": "SUBJECT",
                    "serviceId": actor,
                    "purposeId": self._account_purpose,
                    "state": STATE_ACTIVE,
                },
            )
            rows = body.get("Consents") or body.get("consents") or []
            # At most one is live (a new consent replaces the last), but list
            # rows carry no elements, so each candidate is read in full.
            for row in reversed(rows):  # newest last in the listing
                record = await self.get(str(row["id"]))
                # Expiry is lazy: a consent past its time can still list as
                # ACTIVE until something reads it.
                if record.active and record.subject == subject and record.actor == actor:
                    return record
        except ConsentServiceError as exc:
            logger.warning("Consent lookup failed: %s", exc)
        return None

    async def validate(self, *, consent_id: str, subject: str, permissions: frozenset[str]) -> bool:
        """The check at the point of use: is this consent live, this
        customer's, and does it grant these permissions?

        The store's validate answers the state (with its expiry applied); the
        owner and the permissions are compared here, from the record.
        """
        state = await self._request("GET", f"/consents/{consent_id}/validate")
        if str(state.get("state", "")).upper() != STATE_ACTIVE:
            logger.warning("Consent %s rejected: state %s", consent_id, state.get("state"))
            return False
        record = await self.get(consent_id)
        if record.subject != subject:
            logger.warning("Consent %s rejected: it belongs to another subject", consent_id)
            return False
        if not permissions <= record.permissions:
            logger.warning(
                "Consent %s rejected: lacks %s", consent_id, " ".join(sorted(permissions - record.permissions))
            )
            return False
        return True
