"""Exchange the caller's delegated token for one this server can present to the
bank's APIs (RFC 8693).

The incoming token already identifies the end user (`sub`) and the agent acting
for them (`act.sub`). This exchange re-points it at the bank's audience and
narrows the scope to just what the current tool needs -- a token minted for
reading balances cannot read transaction history, so a leaked one is bounded by
the operation it was issued for.

An `actor_token` IS sent, and has to be. That comment used to claim ThunderID
leaves an existing `act` chain untouched when none is supplied -- it does not.
With no actor token the issued token carries no `act` at all, so the bank saw
the customer apparently acting alone, with both the agent and this server
missing from the record. The token presented here names this server as subject
and the agent as its actor, which ThunderID re-emits as
`act: {sub: apex-mcp-client, act: {sub: apex-banking-agent}}`. See
outbound/actor_chain.py.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from dataclasses import dataclass

import httpx
from opentelemetry.instrumentation.utils import suppress_http_instrumentation

logger = logging.getLogger(__name__)

TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange"
JWT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt"
ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"


class BankTokenExchangeError(Exception):
    """Raised when the bank-audience token exchange fails."""


@dataclass
class BankAccessToken:
    access_token: str
    expires_at: float
    scope: str

    def expired(self, margin_seconds: float = 30.0) -> bool:
        return time.time() >= self.expires_at - margin_seconds


def _chain(token: str) -> str:
    """`sub` and the nested `act` subjects, as `customer < agent < mcp`.

    Decoded without verifying: this server just received the token from the
    issuer over TLS, and the value is used for a log line, never for a
    decision. No token material is emitted -- only the subject identifiers,
    which are already in every other log line here.
    """
    try:
        body = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    except Exception:  # noqa: BLE001 -- a log line must never break a payment
        return "unreadable"
    parts = [str(claims.get("sub"))]
    act = claims.get("act")
    while isinstance(act, dict):
        parts.append(str(act.get("sub")))
        act = act.get("act")
    return " < ".join(parts)


def _oauth_error(response: httpx.Response) -> str:
    """Extract `error`/`error_description` (RFC 6749 S5.2), never the raw body,
    which can carry token material."""
    try:
        payload = response.json()
    except ValueError:
        return f"Token endpoint returned {response.status_code}"
    code = payload.get("error", "unknown_error")
    description = payload.get("error_description")
    return f"{code}: {description}" if description else str(code)


async def exchange_for_bank_token(
    *,
    token_endpoint: str,
    client_id: str,
    client_secret: str,
    subject_token: str,
    audience: str,
    scope: str,
    actor_token: str | None = None,
) -> BankAccessToken:
    """Exchange `subject_token` for a bank-audience token limited to `scope`.

    `scope` should be only what the calling tool needs, not everything the
    caller is entitled to. The exchange can narrow but never widen, so anything
    the subject token lacks is silently omitted from the result.

    `actor_token` is this server's own token recorded as acting for the agent
    (see outbound/actor_chain.py). Supplying it is what makes the bank token
    carry the full `customer -> agent -> MCP` chain; omitting it still yields a
    valid token, just one with no `act` claim at all.
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
                        "requested_token_type": ACCESS_TOKEN_TYPE,
                        # `resource`, not `audience`. ThunderID accepts `audience`
                        # and then ignores it: the request is permission-bearing
                        # with no resource indicator, so it binds to the SERVER's
                        # defaultResourceServer -- which here belongs to AMP and
                        # defines none of the apex permissions. Every scope is then
                        # filtered out and the exchange returns 200 with an empty
                        # scope, so the failure only surfaces at the bank.
                        "resource": audience,
                        "scope": scope,
                        **(
                            {"actor_token": actor_token, "actor_token_type": JWT_TOKEN_TYPE}
                            if actor_token
                            else {}
                        ),
                    },
                    headers={"Accept": "application/json"},
                )
    except httpx.HTTPError as exc:
        raise BankTokenExchangeError(f"Token exchange request failed: {exc}") from exc

    if response.status_code != 200:
        logger.warning("Bank token exchange failed (%s)", response.status_code)
        raise BankTokenExchangeError(_oauth_error(response))

    payload = response.json()
    granted = payload.get("scope", "")
    missing = sorted(set(scope.split()) - set(granted.split()))
    if missing:
        logger.warning("Bank token missing requested scope(s): %s", " ".join(missing))

    # The delegation this token actually asserts, flattened. This is the line
    # that shows whether the bank will see `customer -> agent -> MCP` or just
    # the customer acting alone -- the difference is invisible everywhere else
    # until someone reads a token at the bank.
    logger.info("Bank token acquired (scope=%s chain=%s)", granted, _chain(payload["access_token"]))
    return BankAccessToken(
        access_token=payload["access_token"],
        expires_at=time.time() + float(payload.get("expires_in", 3600)),
        scope=granted,
    )
