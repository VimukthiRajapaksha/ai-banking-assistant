"""Agent self-authentication ("Agent Acting on Its Own", WSO2 Agent Identity).

Deterministic, no end user, no LLM call: submit this agent's own credentials
(agent_id/agent_secret) through WSO2's native/API-based auth flow to get an
`actor_token` -- the JWT that later identifies THIS agent (`act.sub`) when it
delegates on behalf of an end user (see delegation.py).

The agent identity is an OAuth client on ThunderID, so this is a plain
client_credentials grant authenticated with the agent's own id and secret.
"""

from __future__ import annotations

import asyncio
import logging
import time

import httpx
from opentelemetry.instrumentation.utils import suppress_http_instrumentation

from ai_banking_agent.settings import IdentitySettings

logger = logging.getLogger(__name__)

REFRESH_MARGIN_SECONDS = 30


def _safe_error(response: httpx.Response) -> str:
    """A loggable summary of a failed auth response.

    Never returns the raw body. These endpoints answer with credential material
    on success (`authData.code`) and can echo request context on failure, so
    only the bounded, spec-defined error fields are extracted -- OAuth's
    `error`/`error_description` (RFC 6749 S5.2) and WSO2's `code`/`description`.
    """
    try:
        payload = response.json()
    except ValueError:
        return f"HTTP {response.status_code}"
    if not isinstance(payload, dict):
        return f"HTTP {response.status_code}"
    for code_key, detail_key in (("error", "error_description"), ("code", "description")):
        if code_key in payload:
            code = payload.get(code_key)
            detail = payload.get(detail_key)
            return f"{code}: {detail}" if detail else str(code)
    return f"HTTP {response.status_code}"


class AgentSelfAuthError(Exception):
    pass


class AgentIdentity:
    """Caches this agent's own actor_token at process scope.

    Never uses a refresh_token even when the IdP returns one -- redoes the
    whole deterministic sequence from scratch once the cached token is within
    REFRESH_MARGIN_SECONDS of expiry, per the simplification agreed for this
    project (no silent refresh anywhere in the agent-side auth model).
    """

    def __init__(self, settings: IdentitySettings) -> None:
        self._settings = settings
        self._token: str | None = None
        self._expires_at: float = 0.0
        self._lock = asyncio.Lock()

    async def get_actor_token(self) -> str:
        async with self._lock:
            if self._token is not None and time.time() < self._expires_at - REFRESH_MARGIN_SECONDS:
                return self._token
            await self._self_authenticate()
            assert self._token is not None
            return self._token

    async def _self_authenticate(self) -> None:
        """Obtain this agent's own actor_token.

        One request. On ThunderID an agent identity IS an OAuth client with its
        own id and secret, so it authenticates as itself -- where the previous
        IdP modelled it as a directory principal and required a three-step
        native flow (authorize -> authn with agent_id/agent_secret -> token)
        just to arrive at the same place.

        `resource` is not optional: ThunderID issues scopes per resource
        indicator, and without one the token comes back scoped to the server's
        default resource carrying none of the scopes this agent needs -- which
        then fails much later, as a delegated exchange that quietly grants
        nothing.
        """
        s = self._settings
        logger.debug("Authenticating the agent identity")
        # Not traced: credential plumbing, not part of what the customer asked.
        with suppress_http_instrumentation():
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(
                    s.token_endpoint,
                    auth=(s.agent_id, s.agent_secret.get_secret_value()),
                    data={
                        "grant_type": "client_credentials",
                        "scope": s.self_scope,
                        "resource": s.self_resource,
                    },
                )
                if response.status_code != 200:
                    logger.warning(
                        "agent self-auth failed (%s): %s", response.status_code, _safe_error(response)
                    )
                    raise AgentSelfAuthError(f"agent self-auth failed ({response.status_code})")
                payload = response.json()

        self._token = payload["access_token"]
        self._expires_at = time.time() + float(payload.get("expires_in", 3600))
        logger.info("Agent self-auth succeeded (expires_in=%ss)", payload.get("expires_in", 3600))
