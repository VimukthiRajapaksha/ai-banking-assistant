"""The actor token that keeps the agent in the bank-facing delegation chain.

ThunderID builds a token's `act` claim from the ACTOR token's claims, and
`act.act` from that actor token's own `act` (`tokenservice/validator.go`
extracts it, `buildActorClaim` re-emits it). So the shape the bank should see

    { "sub": "<customer>",
      "act": { "sub": "apex-mcp-client",
               "act": { "sub": "apex-banking-agent" } } }

requires presenting an actor token whose subject is THIS server and whose own
`act` names the agent. Nothing this server holds produces that on its own: its
client_credentials token names only itself, and exchanging with no actor token
yields `act: {sub: apex-mcp-client}` flat, with the agent gone.

The one input that can produce it is a token issued to the agent, which the
agent forwards on the request (`X-Agent-Actor-Token`). Two exchanges build the
actor token from it, and the result is user-independent -- it says only "the
MCP server, acting for the agent" -- so it is cached per process and reused
across customers until it expires.

Without the header the chain degrades rather than fails: the bank exchange
then sends no actor token, and the bank sees the customer with no `act`. That
is a weaker record, not a wrong one, and it keeps a direct MCP client (no
agent in front) working.
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx
from opentelemetry.instrumentation.utils import suppress_http_instrumentation

logger = logging.getLogger(__name__)

TOKEN_EXCHANGE_GRANT = "urn:ietf:params:oauth:grant-type:token-exchange"
JWT_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:jwt"
ACCESS_TOKEN_TYPE = "urn:ietf:params:oauth:token-type:access_token"

REFRESH_MARGIN_SECONDS = 60.0


class ActorChainError(Exception):
    """Raised when the MCP server cannot mint its own actor token."""


def _oauth_error(response: httpx.Response) -> str:
    """`error`/`error_description` only -- a token endpoint's body carries
    token material and must never reach a log."""
    try:
        payload = response.json()
    except ValueError:
        return f"Token endpoint returned {response.status_code}"
    code = payload.get("error", "unknown_error")
    description = payload.get("error_description")
    return f"{code}: {description}" if description else str(code)


class ActorChain:
    """Caches this server's `acting for the agent` token, per process."""

    def __init__(self, *, token_endpoint: str, client_id: str, client_secret: str, resource: str) -> None:
        self._token_endpoint = token_endpoint
        self._client_id = client_id
        self._client_secret = client_secret
        self._resource = resource
        self._token: str | None = None
        self._expires_at = 0.0
        #: Which agent token the cached value was built from. A different agent
        #: identity must not silently reuse another's chain.
        self._built_from: str | None = None
        self._lock = asyncio.Lock()

    async def actor_token_for(self, agent_token: str) -> str:
        async with self._lock:
            fresh = self._token is not None and time.time() < self._expires_at - REFRESH_MARGIN_SECONDS
            if fresh and self._built_from == agent_token:
                return self._token  # type: ignore[return-value]
            token, expires_in = await self._mint(agent_token)
            self._token = token
            self._expires_at = time.time() + expires_in
            self._built_from = agent_token
            return token

    async def _mint(self, agent_token: str) -> tuple[str, float]:
        auth = (self._client_id, self._client_secret)
        # Not traced: credential plumbing, not part of what the customer asked.
        with suppress_http_instrumentation():
            async with httpx.AsyncClient(timeout=10.0) as client:
                # 1. This server's own identity.
                own = await client.post(
                    self._token_endpoint,
                    auth=auth,
                    data={"grant_type": "client_credentials", "resource": self._resource, "scope": "openid"},
                    headers={"Accept": "application/json"},
                )
                if own.status_code != 200:
                    raise ActorChainError(f"client_credentials failed: {_oauth_error(own)}")
                own_token = own.json()["access_token"]

                # 2. The same identity, now recorded as acting for the agent. This
                #    is the token whose `act` becomes `act.act` on the bank token.
                chained = await client.post(
                    self._token_endpoint,
                    auth=auth,
                    data={
                        "grant_type": TOKEN_EXCHANGE_GRANT,
                        "subject_token": own_token,
                        "subject_token_type": JWT_TOKEN_TYPE,
                        "actor_token": agent_token,
                        "actor_token_type": JWT_TOKEN_TYPE,
                        "requested_token_type": ACCESS_TOKEN_TYPE,
                        "resource": self._resource,
                    },
                    headers={"Accept": "application/json"},
                )
        if chained.status_code != 200:
            raise ActorChainError(f"actor chain exchange failed: {_oauth_error(chained)}")
        payload = chained.json()
        logger.info("Minted MCP actor token acting for the agent")
        return payload["access_token"], float(payload.get("expires_in", 3600))
