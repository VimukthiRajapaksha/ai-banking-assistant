"""Payment step-up: proving the customer is present, for this payment, right now.

Driven from here rather than from the browser. ThunderID addresses a flow by
application, and `apex-mcp-client` owns the `apex-payment-stepup` flow, so this
server starts the flow, carries the WebAuthn challenge out through the tool's
elicitation, and submits the signed response the customer's browser returns.
The model never sees any of it: the challenge and the assertion travel on the
elicitation channel, which no tool argument reaches.

Two things make that possible:

  * The `Flow-Secret` header. An application with no `authorization_code` grant
    is "embedded" to ThunderID and initiates flows with a server credential
    instead of a browser redirect -- which is the whole reason this can be
    server-driven at all. The secret must never reach client-side JavaScript.
  * An RP ID equal to the portal's own host. A credential is bound to the RP
    ID, not to the application that registered it, so a passkey enrolled
    through the portal satisfies a step-up started here.

The flow tries a passkey first and falls back to a password prompt when the
customer has none enrolled. Both paths end in an assertion whose `assurance`
claim names the authenticator that was actually used, so the caller can tell a
biometric confirmation from a typed password rather than assuming.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Literal

import httpx

logger = logging.getLogger(__name__)

#: What the customer is being asked to do this round.
StepUpMode = Literal["passkey", "password", "complete"]


class StepUpError(Exception):
    """Raised when the step-up flow cannot be driven any further."""


@dataclass(frozen=True)
class StepUpState:
    """Where the flow is, carried between rounds inside the sealed requestState."""

    execution_id: str
    challenge_token: str


@dataclass(frozen=True)
class StepUpRound:
    """One round of the ceremony: what to ask, or the assertion that ends it."""

    mode: StepUpMode
    state: StepUpState | None = None
    #: WebAuthn options, verbatim from ThunderID, for `navigator.credentials.get`.
    passkey_challenge: str | None = None
    #: The signed statement that the customer authenticated. Only on `complete`.
    assertion: str | None = None
    #: Why the passkey path was abandoned, when it was. Shown to nobody, logged.
    fallback_reason: str | None = None


def _error_text(payload: dict) -> str:
    error = payload.get("error") or {}
    description = error.get("description") or {}
    message = error.get("message") or {}
    return (
        description.get("defaultValue")
        or message.get("defaultValue")
        or error.get("code")
        or "unknown error"
    )


class StepUpClient:
    """Drives ThunderID's payment step-up flow."""

    def __init__(self, *, base_url: str, application_id: str, flow_secret: str) -> None:
        self._url = f"{base_url.rstrip('/')}/flow/execute"
        self._application_id = application_id
        self._flow_secret = flow_secret

    async def _post(self, body: dict) -> dict:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                response = await client.post(
                    self._url,
                    json=body,
                    headers={"Flow-Secret": self._flow_secret, "Accept": "application/json"},
                )
        except httpx.HTTPError as exc:
            raise StepUpError(f"step-up flow unreachable: {exc}") from exc
        if response.status_code >= 300:
            raise StepUpError(f"step-up flow returned {response.status_code}")
        return response.json()

    async def begin(self, username: str) -> StepUpRound:
        """Start the ceremony for `username` and return the first question.

        The username comes from the verified access token, never from a tool
        argument: it decides WHOSE authentication satisfies this payment, and a
        value the model could choose would let it authorise a payment as
        somebody else.
        """
        started = await self._post(
            {"applicationId": self._application_id, "flowType": "AUTHENTICATION"}
        )
        identified = await self._post(
            {
                "executionId": started["executionId"],
                "challengeToken": started["challengeToken"],
                "actionId": "action_identify",
                "inputs": {"username": username},
            }
        )
        return self._interpret(identified)

    async def submit(self, state: StepUpState, inputs: dict, *, action_id: str | None = None) -> StepUpRound:
        """Send the customer's answer and return the next round, or the assertion."""
        body: dict = {
            "executionId": state.execution_id,
            "challengeToken": state.challenge_token,
            "inputs": inputs,
        }
        if action_id:
            body["actionId"] = action_id
        return self._interpret(await self._post(body))

    def _interpret(self, payload: dict) -> StepUpRound:
        status = payload.get("flowStatus")
        if status == "COMPLETE":
            assertion = payload.get("assertion")
            if not assertion:
                raise StepUpError("step-up completed without an assertion")
            return StepUpRound(mode="complete", assertion=assertion)

        state = StepUpState(
            execution_id=payload.get("executionId", ""),
            challenge_token=payload.get("challengeToken", ""),
        )
        data = payload.get("data") or {}
        additional = data.get("additionalData") or {}

        challenge = additional.get("passkeyChallenge")
        if challenge:
            return StepUpRound(mode="passkey", state=state, passkey_challenge=challenge)

        identifiers = {i.get("identifier") for i in data.get("inputs", [])}
        if "password" in identifiers:
            # Reached either because no passkey is enrolled or because the
            # ceremony failed. The flow's own error says which, and it matters:
            # the assertion that follows will name CredentialsAuthenticator, and
            # a caller that requires a biometric has to be able to refuse it.
            reason = _error_text(payload) if payload.get("error") else None
            if reason:
                logger.info("Step-up falling back to a password prompt: %s", reason)
            return StepUpRound(mode="password", state=state, fallback_reason=reason)

        raise StepUpError(f"unexpected step-up round: {_error_text(payload)}")


def authenticators(assertion: str) -> list[str]:
    """Which authenticators the assertion says were actually used.

    Decoded without verifying the signature: this server received the assertion
    directly from the issuer over TLS in response to its own flow, and the value
    is used to describe what happened, not to decide that it happened.

    ThunderID names `CredentialsAuthenticator` for the password fallback. A
    passkey completion currently reports NO authenticator at all --
    `PasskeyAuthExecutor` is missing from ThunderID's executor-to-authenticator
    map -- so an empty list means the passkey path, not an unauthenticated one.
    That is an upstream gap, and the discriminator is deliberately written as
    "did a password do this", which stays correct whichever way it is fixed.
    """
    try:
        body = assertion.split(".")[1]
        claims = json.loads(__import__("base64").urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except Exception:  # noqa: BLE001 -- never break a payment over a log detail
        return []
    assurance = claims.get("assurance") or {}
    return [a.get("authenticator") for a in assurance.get("authenticators", []) if a.get("authenticator")]


def assertion_subject(assertion: str) -> str | None:
    """The subject the assertion was issued for, so it can be checked against
    the access token's. A step-up that authenticated somebody else must not
    authorise this payment."""
    try:
        body = assertion.split(".")[1]
        claims = json.loads(__import__("base64").urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except Exception:  # noqa: BLE001
        return None
    return claims.get("sub")
