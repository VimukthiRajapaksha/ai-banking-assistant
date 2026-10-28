"""This server's OAuth client for the bank: PKCE Authorization Code flow.

Driven by URL-mode elicitation so bank credentials/consent never pass
through the agent or the MCP transport. No correlation ID here -- callers
(tools/accounts.py, outbound/routes.py) own that.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import secrets
import time
from dataclasses import dataclass
from urllib.parse import urlencode

import httpx
from opentelemetry.instrumentation.utils import suppress_http_instrumentation

logger = logging.getLogger(__name__)


@dataclass
class BankToken:
    access_token: str
    token_type: str
    expires_at: float
    refresh_token: str | None = None
    scope: str | None = None


class BankTokenExchangeError(Exception):
    """Raised when the authorization-code -> token exchange fails."""


def _oauth_error_message(response: httpx.Response) -> str:
    """Extract `error`/`error_description` from an RFC 6749 SS5.2 error response.

    Deliberately does not fall back to the raw response body: unlike this
    bounded, spec-defined pair, an arbitrary body is not safe to surface.
    """
    try:
        payload = response.json()
    except ValueError:
        return f"Token endpoint returned {response.status_code}"
    code = payload.get("error", "unknown_error")
    description = payload.get("error_description")
    return f"{code}: {description}" if description else str(code)


def generate_pkce_pair() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) for an S256 PKCE exchange (RFC 7636)."""
    code_verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    digest = hashlib.sha256(code_verifier.encode()).digest()
    code_challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return code_verifier, code_challenge


def build_authorize_url(
    *,
    authorize_endpoint: str,
    client_id: str,
    redirect_uri: str,
    scope: str,
    state: str,
    code_challenge: str,
) -> str:
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "scope": scope,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    return f"{authorize_endpoint}?{urlencode(params)}"


async def exchange_code_for_token(
    *,
    token_endpoint: str,
    code: str,
    redirect_uri: str,
    client_id: str,
    client_secret: str,
    code_verifier: str,
) -> BankToken:
    """Exchange an authorization code for a bank access token (RFC 6749 S4.1.3)."""
    try:
        # Not traced: credential plumbing, not part of what the customer asked.
        with suppress_http_instrumentation():
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    token_endpoint,
                    data={
                        "grant_type": "authorization_code",
                        "code": code,
                        "redirect_uri": redirect_uri,
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "code_verifier": code_verifier,
                    },
                    headers={"Accept": "application/json"},
                )
    except httpx.HTTPError as exc:
        raise BankTokenExchangeError(f"Token endpoint request failed: {exc}") from exc

    logger.debug("POST %s -> %s", token_endpoint, response.status_code)

    if response.status_code != 200:
        raise BankTokenExchangeError(_oauth_error_message(response))

    payload = response.json()
    expires_in = payload.get("expires_in", 3600)
    return BankToken(
        access_token=payload["access_token"],
        token_type=payload.get("token_type", "Bearer"),
        expires_at=time.time() + float(expires_in),
        refresh_token=payload.get("refresh_token"),
        scope=payload.get("scope"),
    )
