"""Client for the consent service (OpenFGC).

This server may CREATE and READ consents, and VALIDATE them before acting. It
deliberately cannot APPROVE one: approval is an authorization resource carried
under the end user's own identity, so a compromised or prompt-injected agent
relaying through this server cannot manufacture a consent the user never gave.
Anything this server receives claiming approval is treated purely as a signal
to go and re-read the record.

Consent lifecycle: CREATED -> ACTIVE (an APPROVED authorization) -> EXPIRED /
REVOKED / REJECTED.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

STATUS_CREATED = "CREATED"
STATUS_ACTIVE = "ACTIVE"

#: Marks the consent as belonging to this project rather than another consumer
#: of the same consent service, so attribute search cannot collide.
#: Consent types. A lookup that ignores these finds the wrong record: a
#: customer holds both kinds at once and they grant completely different things.
CONSENT_TYPE_ACCOUNT_INFORMATION = "account-information"
CONSENT_TYPE_PAYMENT = "payment"

ATTR_APPLICATION = "application"
ATTR_SUBJECT = "subject"
ATTR_ACTOR = "actor"
ATTR_ACTIVATED_VIA = "activatedVia"
ATTR_CLIENT = "client"
ATTR_PAYEE = "payee"
#: Where the money goes, as the customer's consent portal shows it. Recorded
#: with the consent so the record states the whole payment, not just a name.
ATTR_PAYEE_ACCOUNT_NUMBER = "payeeAccountNumber"
ATTR_PAYEE_BANK = "payeeBank"
ATTR_AMOUNT = "amount"
ATTR_CURRENCY = "currency"
#: Why the customer said they were paying. Part of what they approved, so it is
#: recorded with the approval rather than only sent to the bank.
ATTR_REFERENCE = "reference"
#: How presence was proved for this payment -- the authenticators the step-up
#: assertion named. An empty value means the passkey path, which ThunderID does
#: not yet report by name (see outbound/stepup.authenticators).
ATTR_STEPUP = "stepUp"


class ConsentServiceError(Exception):
    """Raised when the consent service cannot be reached or rejects a call."""


def _now_ms() -> int:
    """Wall clock in milliseconds.

    The consent service's timestamps are milliseconds -- its own `createdTime`
    and `updatedTime` are, and it stores `expirationTime` verbatim rather than
    normalising it. Sending seconds put every expiry ~55,000 years out, so
    consents never expired no matter what validity was configured.
    """
    return int(time.time() * 1000)


@dataclass
class ConsentRecord:
    consent_id: str
    status: str
    permissions: frozenset[str]
    expiration_time: int
    #: Who the consent is for, and which agent it authorises. Read back from
    #: the record rather than trusted from the caller: this pair is what makes
    #: an approval belong to the customer in front of it.
    subject: str = ""
    actor: str = ""
    #: Only set on a payment consent: the funding account the user picked when
    #: approving. Recorded on the authorization, not at creation, because the
    #: user chooses it at approval time.
    debtor_account: str | None = None

    @property
    def active(self) -> bool:
        if self.status != STATUS_ACTIVE:
            return False
        return self.expiration_time == 0 or self.expiration_time > _now_ms()


def _permissions_of(payload: dict) -> frozenset[str]:
    """The permissions a consent actually grants.

    Only elements the user APPROVED count. The record also carries elements
    they declined (`approved: false`), which is deliberate -- a denial is worth
    keeping for audit and to avoid re-asking -- but it must never be read as a
    grant.
    """
    names: set[str] = set()
    for purpose in payload.get("purposes") or []:
        for element in purpose.get("elements") or []:
            if isinstance(element, dict) and element.get("approved") and element.get("name"):
                names.add(element["name"])
    return frozenset(names)


def _debtor_account_of(payload: dict) -> str | None:
    for authorization in payload.get("authorizations") or []:
        resources = authorization.get("resources") or {}
        accounts = resources.get("accountIds") if isinstance(resources, dict) else None
        if accounts:
            return accounts[0]
    return None


def _record(payload: dict) -> ConsentRecord:
    return ConsentRecord(
        consent_id=payload.get("id", ""),
        status=str(payload.get("status", "")).upper(),
        permissions=_permissions_of(payload),
        expiration_time=int(payload.get("expirationTime") or 0),
        subject=str((payload.get("attributes") or {}).get("subject") or ""),
        actor=str((payload.get("attributes") or {}).get("actor") or ""),
        debtor_account=_debtor_account_of(payload),
    )


class ConsentClient:
    def __init__(self, *, base_url: str, org_id: str, group_id: str, timeout: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._org_id = org_id
        self._group_id = group_id
        self._timeout = timeout

    def _headers(self) -> dict[str, str]:
        # Both headers are required: org-id scopes the tenant, group-id the
        # consent group. Omitting group-id fails with "group-id header is
        # required" rather than defaulting.
        return {"Accept": "application/json", "org-id": self._org_id, "group-id": self._group_id}

    async def _request(self, method: str, path: str, **kwargs) -> dict:
        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                response = await client.request(
                    method, f"{self._base_url}{path}", headers=self._headers(), **kwargs
                )
        except httpx.HTTPError as exc:
            raise ConsentServiceError(f"{method} {path} failed: {exc}") from exc
        if response.status_code >= 300:
            # Bodies here describe consent state, never credentials, so the
            # status alone would lose the only useful diagnostic.
            raise ConsentServiceError(f"{method} {path} returned {response.status_code}: {response.text[:200]}")
        return response.json() if response.content else {}

    async def create(
        self,
        *,
        consent_type: str,
        subject: str,
        actor: str,
        permissions: frozenset[str],
        purpose_id: str,
        purpose_name: str,
        element_namespace: str,
        validity_seconds: int,
    ) -> ConsentRecord:
        """Create a consent in CREATED state. It grants nothing until the user
        approves it through their own identity.

        Elements must carry their namespace: the service resolves them against
        the purpose and rejects an unqualified name as belonging to namespace
        'default'.
        """
        payload = {
            "type": consent_type,
            "expirationTime": _now_ms() + validity_seconds * 1000,
            "recurringIndicator": True,
            "purposes": [
                {
                    "purposeId": purpose_id,
                    "name": purpose_name,
                    "version": "v1",
                    "elements": [
                        {"name": name, "namespace": element_namespace, "version": "v1", "approved": True}
                        for name in sorted(permissions)
                    ],
                }
            ],
            "attributes": {
                ATTR_APPLICATION: "apex-mcp",
                ATTR_SUBJECT: subject,
                ATTR_ACTOR: actor,
            },
        }
        body = await self._request("POST", "/consents", json=payload)
        record = _record(body)
        logger.info(
            "Consent created (id=%s status=%s permissions=%s)",
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
        purpose_id: str,
        purpose_name: str,
        element_namespace: str,
        validity_seconds: int,
    ) -> ConsentRecord:
        """Create a single-use consent for ONE payment.

        Payee and amount are written as immutable attributes so the gateway can
        check the executed payment against what the user actually approved --
        dynamic linking. Without that, an approval for a small payment could be
        spent on a large one.
        """
        payload = {
            "type": CONSENT_TYPE_PAYMENT,
            "expirationTime": _now_ms() + validity_seconds * 1000,
            # Single use: a payment authorization must not be reusable.
            "recurringIndicator": False,
            "purposes": [
                {
                    "purposeId": purpose_id,
                    "name": purpose_name,
                    "version": "v1",
                    "elements": [
                        {"name": "InitiatePayment", "namespace": element_namespace,
                         "version": "v1", "approved": True}
                    ],
                }
            ],
            "attributes": {
                ATTR_APPLICATION: "apex-mcp",
                ATTR_SUBJECT: subject,
                ATTR_ACTOR: actor,
                ATTR_CLIENT: client_id,
                ATTR_PAYEE: payee,
                ATTR_PAYEE_ACCOUNT_NUMBER: payee_account_number,
                ATTR_PAYEE_BANK: payee_bank,
                ATTR_AMOUNT: amount,
                ATTR_CURRENCY: currency,
                ATTR_REFERENCE: reference,
                ATTR_STEPUP: step_up,
            },
        }
        body = await self._request("POST", "/consents", json=payload)
        record = _record(body)
        logger.info("Payment consent created (id=%s status=%s)", record.consent_id, record.status)
        return record

    async def find_active_payment(self, *, subject: str, actor: str, payee: str, amount: str) -> ConsentRecord | None:
        """An approved, unused consent for exactly this payment.

        Matching on payee and amount is the point: an approval for a different
        payment must never authorise this one.
        """
        try:
            candidates = await self._active_consents(subject=subject, consent_type=CONSENT_TYPE_PAYMENT)
        except ConsentServiceError as exc:
            logger.warning("Payment consent lookup failed: %s", exc)
            return None
        for detail in candidates:
            attributes = detail.get("attributes") or {}
            if attributes.get(ATTR_ACTOR) != actor:
                continue
            if attributes.get(ATTR_PAYEE) != payee or str(attributes.get(ATTR_AMOUNT)) != str(amount):
                continue
            record = _record(detail)
            if record.active:
                return record
        return None

    async def get(self, consent_id: str) -> ConsentRecord:
        return _record(await self._request("GET", f"/consents/{consent_id}"))

    async def find_active(self, *, subject: str, actor: str) -> ConsentRecord | None:
        """Find this user's live ACCOUNT-INFORMATION consent for this agent.

        Searched by identity rather than by id because the caller has an
        identity, not a consent handle. The actor is still checked here: the
        service cannot filter on it, and another agent's consent must not
        count for this one.

        The type filter is load-bearing. A customer accumulates payment
        consents too, and those stay ACTIVE after they are spent; without the
        filter the first one found is returned, it naturally lacks every
        account permission, and the gate concludes there is no consent and asks
        again -- so every read prompted for approval that was already granted,
        but only once the customer had ever made a payment.
        """
        try:
            candidates = await self._active_consents(
                subject=subject, consent_type=CONSENT_TYPE_ACCOUNT_INFORMATION
            )
        except ConsentServiceError as exc:
            logger.warning("Consent lookup failed: %s", exc)
            return None
        for detail in candidates:
            if (detail.get("attributes") or {}).get(ATTR_ACTOR) != actor:
                continue
            # Status is filtered server-side; expiry is not, and a consent the
            # service still calls ACTIVE can be past its expiration time.
            record = _record(detail)
            if record.active:
                return record
        return None

    async def _active_consents(self, *, subject: str, consent_type: str) -> list[dict]:
        """This customer's ACTIVE consents of one type, as full records.

        One filtered search. The previous lookup asked `/consents/attributes`
        for every consent ever created for the subject -- ids only, every
        status -- then fetched each one to read its type and status: a request
        per consent the customer had ever had, on every tool call, growing
        without bound (37 GETs for one demo customer).

        `userIds` matches the authorising user, which `approve` sets to the
        verified token's `sub`; a consent nobody approved is not ACTIVE, so filtering
        on it loses nothing the status filter would have kept. Newest first,
        because the newest live consent is the one to use.
        """
        body = await self._request(
            "GET",
            "/consents",
            params={
                "userIds": subject,
                # This app's consents only. The service has no client filter;
                # the group is how it scopes consents to an application.
                "groupIds": self._group_id,
                "consentTypes": consent_type,
                "consentStatuses": STATUS_ACTIVE,
                "sort": "createdTime:desc",
                "limit": 50,
            },
        )
        return list(body.get("data") or [])

    async def approve(
        self, *, consent_id: str, user_id: str, account_id: str | None = None, account: dict | None = None
    ) -> None:
        """Record the customer's approval, moving the consent to ACTIVE.

        The customer answers in the chat widget; that answer reaches this
        server through the agent, and this server writes it down. The agent
        relays but never decides -- it has no way to reach this call except by
        carrying an answer the customer gave.

        `userId` is the subject from this server's own verified token, not
        anything the caller supplied, so the record names the customer the
        token was issued for.
        """
        body: dict = {"userId": user_id, "type": "authorisation", "status": "APPROVED"}
        if account_id:
            # A payment authorisation also records which account it is drawn
            # from. The bank re-checks it against the submitted payment, so it
            # has to be part of what the customer approved, not a later choice.
            body["resources"] = {"accountIds": [account_id]}
            if account:
                # The account as the customer chose it -- name and number --
                # so their consent portal can say where the money came from.
                # `accountIds` stays the authoritative reference.
                body["resources"]["accounts"] = [{
                    "id": account_id,
                    "name": str(account.get("name") or ""),
                    "accountNumber": str(account.get("accountNumber") or ""),
                }]
        await self._request("POST", f"/consents/{consent_id}/authorizations", json=body)

    async def revoke(self, consent_id: str, *, user_id: str) -> None:
        """Retire a consent that has been spent.

        A payment consent is single-use (`recurringIndicator: false`), but
        nothing marks it used -- left alone it sits ACTIVE until its expiry,
        which is how an authorisation the customer already spent goes on
        looking live in their consent portal.

        Failure is logged and swallowed. This runs AFTER the money has moved,
        so raising here would report a completed payment as failed and invite a
        retry -- the far worse outcome. What is lost is tidiness, not safety:
        the consent still cannot be spent twice, because the gateway checks it
        and it expires on its own.
        """
        try:
            # `actionBy` is required, and it is the customer rather than this
            # server: the record should say the authorisation was spent on
            # their behalf, not that some service revoked it out from under
            # them.
            await self._request("POST", f"/consents/{consent_id}/revoke", json={"actionBy": user_id})
            logger.info("Payment consent retired (id=%s)", consent_id)
        except ConsentServiceError as exc:
            logger.warning("Could not retire spent consent %s: %s", consent_id, exc)

    async def validate(self, *, consent_id: str, subject: str, permissions: frozenset[str]) -> bool:
        """Ask the consent service whether this action is permitted.

        Used as the authoritative check at the point of use: a record read a
        moment ago may since have been revoked.
        """
        body = await self._request(
            "POST",
            "/consents/validate",
            json={
                "consentId": consent_id,
                "userId": subject,
                "groupId": self._group_id,
                "resourceParams": {"permissions": sorted(permissions)},
            },
        )
        valid = bool(body.get("isValid"))
        if not valid:
            logger.warning(
                "Consent %s rejected: %s %s",
                consent_id, body.get("errorMessage"), body.get("errorDescription"),
            )
        return valid
