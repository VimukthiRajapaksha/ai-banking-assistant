"""In-memory pending-authorization and bank-token state for this server
instance, keyed by the authenticated end user and the agent acting for them.

All three stores here are process-local dictionaries: state is lost on restart
and is not shared between instances. They are also swept lazily rather than by
a background task, so an idle process keeps whatever it last held until the
next call touches the store.
"""

from __future__ import annotations

import time

import anyio
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver import Context

from ai_banking_mcp_server.outbound.oauth import BankToken

# Locks and cached tokens outlive a single call, so they need their own upper
# bound or the dictionaries grow for the lifetime of the process.
_SESSION_IDLE_TTL_SECONDS = 3600.0


class SessionKeyError(Exception):
    """Raised when a request cannot be attributed to a specific connection and
    end user, and therefore must not be allowed to touch per-session state."""


def session_key(ctx: Context) -> str:
    """A key identifying *whose* state this is: the end user, and the agent
    acting for them.

    Deliberately not keyed on the transport's session id. An earlier version
    was, with a constant fallback when the `Mcp-Session-Id` header was absent
    -- which silently collapsed every such caller onto one shared key, and that
    key indexes cached bank tokens. Beyond being unsafe, the header only exists
    on the legacy `initialize()` handshake; the modern `discover()` path this
    server is reached through does not set one at all.

    Identity is the right key regardless: a bank authorization belongs to the
    user who granted it, delegated through a particular agent, not to whichever
    connection happened to carry the request. Two connections from the same
    user and agent legitimately share it; a different user, or the same user
    through a different agent, gets a different key.

    Fails closed -- without a verified subject there is no safe key at all.
    """
    access_token = get_access_token()
    subject = getattr(access_token, "subject", None) if access_token else None
    if not subject:
        raise SessionKeyError(
            "Request has no authenticated subject; refusing to share per-session state."
        )

    # RFC 8693 `act.sub`: the agent acting for the user. Absent for a direct
    # (non-delegated) call, which is a distinct case and so a distinct key.
    claims = getattr(access_token, "claims", None) or {}
    actor = (claims.get("act") or {}).get("sub") or "-"
    return f"{subject}:{actor}"


class BankTokenCache:
    """Caches bank tokens per (connection, user). Entries are dropped once the
    token itself expires, so a stale credential is never handed out."""

    def __init__(self) -> None:
        self._tokens: dict[str, BankToken] = {}

    def _sweep(self) -> None:
        now = time.time()
        for key in [k for k, t in self._tokens.items() if t.expires_at <= now]:
            self._tokens.pop(key, None)

    def get(self, session_key: str) -> BankToken | None:
        self._sweep()
        token = self._tokens.get(session_key)
        if token is not None and token.expires_at <= time.time():
            self._tokens.pop(session_key, None)
            return None
        return token

    def set(self, session_key: str, token: BankToken) -> None:
        self._sweep()
        self._tokens[session_key] = token

    def invalidate(self, session_key: str) -> None:
        self._tokens.pop(session_key, None)


class SessionLocks:
    """Per-session lock so concurrent tool calls on the same connection don't
    each start a separate authorization.

    Locks are evicted once a session has been idle long enough, otherwise this
    dictionary only ever grows -- one entry per session for the life of the
    process.
    """

    def __init__(self) -> None:
        self._locks: dict[str, anyio.Lock] = {}
        self._last_used: dict[str, float] = {}

    def _sweep(self) -> None:
        cutoff = time.monotonic() - _SESSION_IDLE_TTL_SECONDS
        for key in [k for k, seen in self._last_used.items() if seen < cutoff]:
            lock = self._locks.get(key)
            # Never evict a held lock: its holder would end up serialising
            # against a lock no later caller can see. `anyio.Lock.locked()`
            # needs a running event loop, so if that cannot be determined,
            # keep the lock -- growing the dict is far cheaper than losing
            # mutual exclusion.
            if lock is not None:
                try:
                    if lock.locked():
                        continue
                except RuntimeError:
                    continue
            self._locks.pop(key, None)
            self._last_used.pop(key, None)

    def for_session(self, session_key: str) -> anyio.Lock:
        self._sweep()
        self._last_used[session_key] = time.monotonic()
        return self._locks.setdefault(session_key, anyio.Lock())
