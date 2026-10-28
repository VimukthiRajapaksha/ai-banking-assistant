"""On-behalf-of delegation: exchange the caller's token for one this agent can
present to the MCP server (RFC 8693).

The result carries `sub` = the end user and `act.sub` = this agent, so the MCP
server (and the bank beyond it) can see both who the request is for and who is
acting. Deterministic and non-interactive -- no browser redirect, no consent
prompt; contrast identity/delegation.py, which is the interactive flow this
replaces.

Two properties of the IdP's delegated exchange drive the design here:

  * It can NARROW scopes but never widen them. The issued token only ever
    contains scopes already present in `subject_token`, so the caller's token
    has to arrive carrying everything the chain will need. Requesting a scope
    the subject lacks is silently dropped rather than rejected -- so callers
    must check what came back, not assume.
  * `actor_token` is what produces the `act` claim. Omit it and the exchange
    still succeeds, but the delegation chain is lost.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass

import httpx
from opentelemetry.instrumentation.utils import suppress_http_instrumentation

logger = logging.getLogger(__name__)

TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange"
JWT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt"
ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"


class DelegatedExchangeError(Exception):
    """Raised when the on-behalf-of token exchange fails."""


@dataclass
class DelegatedToken:
    access_token: str
    expires_at: float
    scope: str

    def expired(self, margin_seconds: float = 30.0) -> bool:
        return time.time() >= self.expires_at - margin_seconds


def _oauth_error(response: httpx.Response) -> str:
    """Extract `error`/`error_description` (RFC 6749 S5.2).

    Deliberately never falls back to the raw body: a token endpoint's response
    can contain token material, which must not reach logs.
    """
    try:
        payload = response.json()
    except ValueError:
        return f"Token endpoint returned {response.status_code}"
    code = payload.get("error", "unknown_error")
    description = payload.get("error_description")
    return f"{code}: {description}" if description else str(code)


async def exchange_for_mcp_token(
    *,
    token_endpoint: str,
    client_id: str,
    client_secret: str,
    subject_token: str,
    actor_token: str,
    audience: str,
    scope: str,
) -> DelegatedToken:
    """Exchange the caller's token for an MCP-audience token acting for the user.

    `audience` must be the MCP API's *resource identifier* and must be
    registered as an allowed audience on this agent's application, otherwise
    the IdP rejects the request with `invalid_target`.
    """
    try:
        # Not traced: credential plumbing, not part of what the customer asked.
        with suppress_http_instrumentation():
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    token_endpoint,
                    auth=(client_id, client_secret),
                    data={
                        "grant_type": TOKEN_EXCHANGE_GRANT,
                        "subject_token": subject_token,
                        "subject_token_type": JWT_TOKEN_TYPE,
                        "actor_token": actor_token,
                        "actor_token_type": JWT_TOKEN_TYPE,
                        "requested_token_type": ACCESS_TOKEN_TYPE,
                        # `resource`, not `audience`. ThunderID accepts `audience`
                        # on a client_credentials grant but ignores it here, and
                        # the exchanged token comes back scoped to the server's
                        # default resource -- which the MCP server then rejects
                        # with "Audience doesn't match", pointing at the token
                        # rather than at the request that produced it.
                        "resource": audience,
                        "scope": scope,
                    },
                    headers={"Accept": "application/json"},
                )
    except httpx.HTTPError as exc:
        raise DelegatedExchangeError(f"Token exchange request failed: {exc}") from exc

    if response.status_code != 200:
        logger.warning("Delegated token exchange failed (%s)", response.status_code)
        raise DelegatedExchangeError(_oauth_error(response))

    payload = response.json()
    granted = payload.get("scope", "")
    missing = sorted(set(scope.split()) - set(granted.split()))
    if missing:
        # Not fatal -- the tool call downstream will fail its own scope check
        # with a clearer message -- but this is the single likeliest cause of a
        # confusing 403 later, so make it visible here.
        logger.warning("Delegated token missing requested scope(s): %s", " ".join(missing))

    logger.info("Delegated token acquired (scope=%s)", granted)
    return DelegatedToken(
        access_token=payload["access_token"],
        expires_at=time.time() + float(payload.get("expires_in", 3600)),
        scope=granted,
    )
