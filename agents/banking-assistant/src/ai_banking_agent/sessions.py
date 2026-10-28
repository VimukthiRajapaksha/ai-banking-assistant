"""Per-chat-session state.

A "session" is identified by an opaque `session_id` this agent mints on first
contact and the frontend echoes on every subsequent /chat call.

One "pending" concept lives here: `SessionRuntime.mcp_request_state`, the MRTR
`request_state` from the MCP server's last `InputRequiredResult`. It is echoed
back on the next tool call so the server can tell whether the out-of-band bank
authorization has completed. No background task or live connection is kept for
this (see mcp_client.py) -- each /chat turn is an independent retry, per MRTR's
own design.

The agent's own delegation is no longer a "pending" concept: it is obtained
non-interactively by exchanging the caller's token (see
identity/token_exchange.py), so there is nothing to wait for.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from ai_banking_agent.identity.token_exchange import DelegatedToken

if TYPE_CHECKING:
    from mcp import ClientSession
    from mcp.types import Tool
    from pydantic_ai.messages import ModelMessage


# Sessions are held only as long as a conversation is plausibly live; without
# this the store grows one entry per session for the life of the process.
SESSION_IDLE_TTL_SECONDS = 3600.0


@dataclass
class ElicitationResponse:
    """The user's answer to a consent form, on its way back to the MCP server.

    Held verbatim. This service never constructs one on the user's behalf.
    """

    key: str
    action: str
    content: dict | None = None


@dataclass
class SessionRuntime:
    session_id: str

    # The `sub` of the token that created this session. Every later request
    # must present the same subject: a session id is otherwise a bearer handle,
    # and anyone who obtained one could resume another user's conversation and
    # reach their delegated token.
    subject: str = ""

    last_used: float = field(default_factory=time.monotonic)

    # Delegated token for calling the MCP server (sub = end user, act = this
    # agent). Cached per session and re-exchanged once close to expiry.
    delegated_token: DelegatedToken | None = None

    #: This agent's OWN token, minted alongside the delegated one and forwarded
    #: to the MCP server so it can put the agent into the bank-facing `act`
    #: chain. ThunderID builds `act.act` from the ACTOR token's own `act`
    #: claim, so the MCP server has to hold a token that names itself as
    #: subject and this agent as actor -- which it can only mint by presenting
    #: this. See identity/token_exchange.py and the MCP server's actor_chain.
    actor_token: str | None = None

    message_history: list[ModelMessage] = field(default_factory=list)
    turn_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    # Per tool, not per session: the MCP server binds each request_state to
    # the request that issued it, so replaying one tool's state on another is
    # rejected outright. One slot per conversation meant a turn needing two
    # consents in sequence -- read an account, then authorise a payment -- sent
    # the payment's state to the account tool and got a 400.
    mcp_request_state: dict[str, str] = field(default_factory=dict)

    # Likewise keyed by tool: an answer belongs to the request that asked.
    pending_elicitation: dict[str, ElicitationResponse] = field(default_factory=dict)

    # Which tool raised each outstanding form, so an answer arriving by its
    # elicitation key can be routed back to the tool that asked for it.
    elicitation_tool: dict[str, str] = field(default_factory=dict)

    # The arguments each outstanding form was raised for. Replayed verbatim on
    # the retry: the customer approved *those* -- a payee and an amount -- and
    # the model re-deciding them between rounds would execute something else.
    # The MCP server binds its requestState to an argument digest, so a
    # difference is also rejected outright rather than silently honoured.
    pending_arguments: dict[str, dict] = field(default_factory=dict)

    # Tools this turn is expected to need, declared to the MCP server so one
    # consent can cover the whole turn. Advisory; the server clamps it.
    planned_tools: list[str] = field(default_factory=list)

    # The MCP session for the turn in progress, if one could be opened.
    # Never outlives the turn -- see mcp_client.turn_connection.
    mcp_session: ClientSession | None = None

    # The MCP server's tool definitions, listed when that session opened. The
    # model's tools are built from these, so the server is the only place a
    # tool is described -- see chat_agent.build_chat_agent.
    mcp_tools: list[Tool] = field(default_factory=list)

    # Cleared once a data tool has succeeded: consent exists from then on, so
    # planning again would buy nothing and costs an LLM call per turn.
    needs_plan: bool = True

    def needs_delegated_token(self) -> bool:
        return self.delegated_token is None or self.delegated_token.expired()

    def consume_elicitation_response(self, tool: str) -> ElicitationResponse | None:
        """Take this tool's pending answer, if any. Single use: a stale answer
        must never be replayed against a later consent request."""
        return self.pending_elicitation.pop(tool, None)

    def touch(self) -> None:
        self.last_used = time.monotonic()

    @property
    def idle_expired(self) -> bool:
        return time.monotonic() - self.last_used > SESSION_IDLE_TTL_SECONDS


class SessionStore:
    """Process-local session state. In-memory, single-instance -- lost on
    restart, not shared across agent instances, matching the equivalent
    limitation already documented on the MCP server's in-memory stores."""

    def __init__(self) -> None:
        self._sessions: dict[str, SessionRuntime] = {}

    def _sweep(self) -> None:
        for session_id in [s for s, r in self._sessions.items() if r.idle_expired]:
            self._sessions.pop(session_id, None)

    def get_or_create(self, session_id: str, subject: str) -> SessionRuntime:
        """Return the session for `session_id`, creating it bound to `subject`.

        Raises PermissionError if an existing session belongs to someone else,
        so a leaked session id cannot be replayed under a different identity.
        """
        self._sweep()
        runtime = self._sessions.get(session_id)
        if runtime is None:
            runtime = SessionRuntime(session_id=session_id, subject=subject)
            self._sessions[session_id] = runtime
            return runtime
        if runtime.subject != subject:
            raise PermissionError("Session does not belong to this user")
        runtime.touch()
        return runtime
