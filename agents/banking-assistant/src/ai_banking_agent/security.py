"""Passkey enrolment, relayed on the customer's behalf.

ThunderID drives enrolment as a flow on `apex-security-client`. That
application has no OAuth profile, so ThunderID treats it as *embedded* and
requires a `Flow-Secret` header to start the flow -- a server credential that
can begin an authentication ceremony for ANY customer. It must never reach
browser JavaScript, which is the whole reason these two endpoints exist: this
service holds the secret and relays each step, and the browser does only the
one part it alone can do, `navigator.credentials.create()`.

Two things bound what a caller can do here:

  * **The account comes from a verified token, never the request.** The flow is
    started for the `username` claim of a token this service has checked the
    signature, issuer and audience of. A username in the body would let anyone
    enrol a passkey against someone else's account.
  * **The customer must have authenticated MOMENTS AGO.** A live session is not
    enough to add a second factor -- that is the point of a second factor. So
    the caller presents the ID token from a fresh sign-in and this service
    checks its `auth_time`.

    Deliberately NOT a password field of our own. The ceremony has to run at the
    portal's origin, and ThunderID only collects passwords on its own hosted
    page at a different origin -- so a password step here would mean the
    customer typing their banking password into a box our code renders, and our
    services forwarding it. That is what federated identity exists to avoid,
    and it teaches exactly the habit that makes phishing work. ThunderID
    honours neither `prompt=login` nor `max_age` (both are validated and then
    ignored outside the `prompt=none` path), so the portal ends the session and
    lets the customer sign in again on ThunderID's page instead.
"""

from __future__ import annotations

import logging
import time

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from starlette.requests import Request

from ai_banking_agent.identity.token_verifier import (
    CustomerTokenVerifier,
    TokenVerificationError,
)

logger = logging.getLogger(__name__)


class StartRequest(BaseModel):
    """Proof of a fresh sign-in, in place of a password.

    The ID token from the sign-in that just happened. Its `auth_time` is the
    claim that matters -- the access token does not carry one -- and it is
    checked for freshness and against the access token's subject.
    """

    id_token: str


class StartResponse(BaseModel):
    #: WebAuthn creation options, verbatim from ThunderID, for the browser.
    creation_options: str
    #: Opaque flow handles the browser echoes back on finish. Not credentials:
    #: without the Flow-Secret they cannot drive the flow, and the flow is
    #: already bound to the authenticated customer.
    execution_id: str
    challenge_token: str


class FinishRequest(BaseModel):
    execution_id: str
    challenge_token: str
    credential_id: str
    client_data_json: str
    attestation_object: str


def _flow_error(payload: dict) -> str:
    error = payload.get("error") or {}
    return (
        (error.get("description") or {}).get("defaultValue")
        or (error.get("message") or {}).get("defaultValue")
        or error.get("code")
        or "unknown error"
    )


def build_router(
    *,
    verifier: CustomerTokenVerifier,
    thunder_base_url: str,
    application_id: str,
    flow_secret: str,
    portal_client_id: str,
    max_auth_age_seconds: int,
) -> APIRouter:
    router = APIRouter(prefix="/security/passkey")
    flow_url = f"{thunder_base_url.rstrip('/')}/flow/execute"

    async def _flow(body: dict) -> dict:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                flow_url,
                json=body,
                headers={"Flow-Secret": flow_secret, "Accept": "application/json"},
            )
        if response.status_code >= 300:
            logger.warning("Enrolment flow returned %s", response.status_code)
            raise HTTPException(status_code=502, detail="Passkey enrolment is unavailable.")
        return response.json()

    async def _fresh_auth(body_token: str, subject: str) -> None:
        """Require that the customer authenticated within the last few minutes.

        Three checks, and all three matter: the token is really ThunderID's
        (signature and issuer), it was issued to THIS application (audience), and
        it names the same subject as the access token -- otherwise a valid ID
        token from another session would do.
        """
        try:
            claims = await verifier.verify_id_token(body_token, client_id=portal_client_id)
        except TokenVerificationError:
            raise HTTPException(status_code=401, detail="Please sign in again to add a passkey.") from None
        if claims.get("sub") != subject:
            logger.warning("Refusing passkey enrolment: id_token subject does not match the session")
            raise HTTPException(status_code=403, detail="Please sign in again to add a passkey.")
        auth_time = claims.get("auth_time")
        if not isinstance(auth_time, int | float):
            # Without it there is nothing proving a recent sign-in, and treating
            # its absence as "recent enough" would defeat the whole check.
            raise HTTPException(status_code=401, detail="Please sign in again to add a passkey.")
        age = time.time() - float(auth_time)
        if age > max_auth_age_seconds:
            logger.info("Refusing passkey enrolment: last sign-in was %.0fs ago", age)
            raise HTTPException(status_code=401, detail="Please sign in again to add a passkey.")

    async def _username(request: Request) -> tuple[str, str]:
        header = request.headers.get("authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise HTTPException(status_code=401, detail="Missing bearer token")
        try:
            claims = await verifier.verify(token)
        except TokenVerificationError:
            raise HTTPException(status_code=401, detail="Invalid token") from None
        username = claims.get("username") or claims.get("email")
        subject = claims.get("sub")
        if not username or not subject:
            # Without these there is no way to name whose account is being
            # changed, and guessing is the whole vulnerability.
            raise HTTPException(status_code=403, detail="This session cannot enrol a passkey.")
        return str(username), str(subject)

    @router.post("/start", response_model=StartResponse)
    async def start(body: StartRequest, request: Request) -> StartResponse:
        username, subject = await _username(request)
        await _fresh_auth(body.id_token, subject)
        started = await _flow({"applicationId": application_id, "flowType": "AUTHENTICATION"})
        authenticated = await _flow({
            "executionId": started["executionId"],
            "challengeToken": started["challengeToken"],
            "actionId": "action_identify",
            "inputs": {"username": username},
        })
        options = ((authenticated.get("data") or {}).get("additionalData") or {}).get(
            "passkeyCreationOptions"
        )
        if not options:
            logger.warning("Passkey enrolment did not reach registration: %s", _flow_error(authenticated))
            raise HTTPException(status_code=502, detail="Passkey setup could not be started.")
        logger.info("Passkey enrolment started")
        return StartResponse(
            creation_options=options,
            execution_id=authenticated["executionId"],
            challenge_token=authenticated["challengeToken"],
        )

    @router.post("/finish")
    async def finish(body: FinishRequest, request: Request) -> dict:
        # Re-checked on this leg too: the handles came back from the browser,
        # and an endpoint that only authenticates the first half of a ceremony
        # is not authenticated.
        await _username(request)
        completed = await _flow({
            "executionId": body.execution_id,
            "challengeToken": body.challenge_token,
            "inputs": {
                "credentialId": body.credential_id,
                "clientDataJSON": body.client_data_json,
                "attestationObject": body.attestation_object,
            },
        })
        if completed.get("flowStatus") != "COMPLETE":
            logger.warning("Passkey enrolment did not complete: %s", _flow_error(completed))
            raise HTTPException(status_code=400, detail="That passkey could not be registered.")
        logger.info("Passkey enrolled")
        return {"status": "enrolled"}

    return router
