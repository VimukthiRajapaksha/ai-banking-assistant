"""MCP tool calls over one connection per /chat turn.

No connection outlives a turn, matching MRTR's own design: "the server
processing the retry does not need any information beyond what is directly
present in the retry request" -- so there is no reason to keep one
`ClientSession` alive across /chat turns (contrast the old server-push
elicitation model this replaces, which needed a persistent session to receive
an async notification).

Within a turn, though, one session is shared by every tool call. A session per
call re-ran `server/discover` before each call and a `tools/list` after it (the
SDK lists tools to validate a result against the tool's output schema, and its
cache lived and died with the session) -- three round trips for one tool, and
a trace in which discovery appeared to happen *inside* each tool.

Deliberately uses the low-level `ClientSession.call_tool(allow_input_required=True)`
instead of the SDK's convenience `Client.call_tool()`: the convenience path
auto-retries `InputRequiredResult` internally with a backoff capped at 250ms
and a ~10-round limit -- both far too short for a user completing a bank
authorization in their own browser. Driving one round at a time, and letting
the caller decide when to retry (i.e. the next /chat turn), is what makes the
bank-authorization wait non-blocking.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager

import httpx
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.types import ElicitResult, InputRequiredResult, TextContent

from ai_banking_agent.sessions import SessionRuntime
from ai_banking_agent.telemetry import untraced

logger = logging.getLogger(__name__)

class ConsentRequired(Exception):
    """Raised when the MCP server needs the user's consent before this tool
    call can complete.

    Carries the form the user must answer. The agent renders nothing itself --
    it relays this to the frontend and relays the user's answer back verbatim.
    """

    def __init__(
        self, *, key: str, tool: str, message: str, schema: dict,
        consent_id: str | None, request_state: str | None,
    ) -> None:
        super().__init__(f"Consent required: {message}")
        self.key = key
        #: Which tool asked. The answer has to go back to the same one -- a
        #: turn can have two forms outstanding from two different tools.
        self.tool = tool
        self.message = message
        self.schema = schema
        self.consent_id = consent_id
        self.request_state = request_state


def _headers(runtime: SessionRuntime) -> dict[str, str]:
    token = runtime.delegated_token
    if token is None:
        raise RuntimeError("MCP call attempted without a delegated token")
    headers = {"Authorization": f"Bearer {token.access_token}"}
    # The agent's own token, so the MCP server can mint an actor token naming
    # itself as subject and this agent as actor -- the only way ThunderID will
    # emit `act.act`, and so the only way the bank sees
    # `customer -> agent -> MCP` rather than the MCP acting alone. A separate
    # header rather than the MCP `meta`: it is a credential, it must not be
    # confused with tool arguments, and `meta` reaches the tool as data.
    if runtime.actor_token:
        headers["X-Agent-Actor-Token"] = runtime.actor_token
    return headers


@asynccontextmanager
async def _open_session(server_url: str, runtime: SessionRuntime) -> AsyncIterator[ClientSession]:
    async with httpx.AsyncClient(headers=_headers(runtime), timeout=30) as http_client:
        # Yields exactly two streams -- the session-id accessor that mcp 1.x's
        # streamablehttp_client returned as a third value is gone in 2.x.
        async with streamable_http_client(f"{server_url.rstrip('/')}/mcp", http_client=http_client) as (read, write):
            async with ClientSession(read, write) as session:
                # discover(), not initialize(): the legacy `initialize()`
                # handshake only negotiates up to 2025-11-25, and MRTR's
                # InputRequiredResult is 2026-07-28 vocabulary -- a server
                # returning one over a handshake-negotiated session fails
                # result serialization ("Handler returned an invalid result").
                await session.discover()
                yield session


@asynccontextmanager
async def turn_connection(server_url: str, runtime: SessionRuntime) -> AsyncIterator[None]:
    """Hold one MCP session for the duration of a /chat turn.

    Discovery and the tool listing happen here, up front, the way any MCP
    client connects -- not lazily inside the first tool call. The listing is
    what the model's tools are built from, and it needs the customer's
    delegated token, which is why it is per turn rather than at startup. If the server
    cannot be reached the turn still runs: a reply that needs no tool should
    not fail because the bank is down, and a tool call then opens its own
    session and reports the failure where it belongs.
    """
    try:
        async with AsyncExitStack() as stack:
            try:
                # Connection set-up (discover, list) is not traced. The tool
                # calls this session later carries make their `MCP send
                # tools/call` spans in the caller's context, so those are
                # still recorded; only the HTTP transport under them is not.
                with untraced():
                    session = await stack.enter_async_context(_open_session(server_url, runtime))
                    runtime.mcp_tools = (await session.list_tools()).tools
            except Exception as exc:  # noqa: BLE001 - degrade, never block the turn
                logger.warning("MCP connection for this turn failed; tools will connect per call: %s", exc)
                await stack.aclose()
                session = None
            runtime.mcp_session = session
            try:
                yield
            finally:
                runtime.mcp_session = None
                runtime.mcp_tools = []
    except BaseExceptionGroup as group:
        # The whole turn runs inside the SDK's anyio task group, which wraps
        # anything the turn raises -- so ConsentRequired came out as an
        # ExceptionGroup and the "awaiting consent" reply became a generic
        # error. One exception in, that one out.
        sole = _sole_exception(group)
        if sole is None:
            raise
        raise sole from None


def _sole_exception(group: BaseExceptionGroup) -> BaseException | None:
    leaves: list[BaseException] = []
    pending: list[BaseException] = [group]
    while pending:
        exc = pending.pop()
        if isinstance(exc, BaseExceptionGroup):
            pending.extend(exc.exceptions)
        else:
            leaves.append(exc)
    return leaves[0] if len(leaves) == 1 else None


async def call_tool(server_url: str, tool_name: str, runtime: SessionRuntime, arguments: dict | None = None) -> str:
    """Call one MCP tool, resuming a bank authorization already tracked for this
    session, or raising AuthorizationRequired if a new one is needed."""

    request_state = runtime.mcp_request_state.get(tool_name)
    if request_state is not None and tool_name in runtime.pending_arguments:
        # Resume the call the customer answered, not whatever the model has
        # decided this time round.
        arguments = runtime.pending_arguments[tool_name]
    # Forward the user's actual answer, never a synthesised one. An earlier
    # version asserted action="accept" whenever a request_state existed, which
    # meant this agent -- not the user -- was the thing granting consent. The
    # MCP server re-reads the consent record regardless, but fabricating an
    # answer here would still be this service speaking for the user.
    pending = runtime.consume_elicitation_response(tool_name)
    input_responses = None
    if pending is not None and request_state is not None:
        input_responses = {
            pending.key: ElicitResult(action=pending.action, content=pending.content or None)
        }
    logger.debug("Calling MCP tool %s (resuming=%s)", tool_name, request_state is not None)

    async def _call(session: ClientSession):
        return await session.call_tool(
            tool_name,
            arguments or {},
            input_responses=input_responses,
            request_state=request_state,
            allow_input_required=True,
            # Advisory: lets one consent cover every tool this turn
            # will use, instead of prompting per tool. The request is
            # already correlated by traceparent, which the
            # instrumented httpx client propagates.
            meta={"planned_tools": runtime.planned_tools},
        )

    if runtime.mcp_session is not None:
        result = await _call(runtime.mcp_session)
    else:
        async with _open_session(server_url, runtime) as session:
            result = await _call(session)

    if isinstance(result, InputRequiredResult):
        key, elicit_request = next(iter(result.input_requests.items()))
        params = elicit_request.params
        runtime.mcp_request_state[tool_name] = result.request_state
        runtime.pending_arguments[tool_name] = arguments or {}
        logger.info("MCP tool %s requires consent (request_state=%s)", tool_name, result.request_state)
        schema = getattr(params, "requested_schema", None) or {}
        raise ConsentRequired(
            key=key,
            tool=tool_name,
            message=getattr(params, "message", "Approval required"),
            schema=schema,
            # Carried inside the schema: `_meta` does not survive the wire and
            # `request_state` is opaque to clients.
            consent_id=schema.get("x-consent-id") if isinstance(schema, dict) else None,
            request_state=result.request_state,
        )

    runtime.mcp_request_state.pop(tool_name, None)
    runtime.pending_arguments.pop(tool_name, None)
    # A tool completed, so consent now exists for this session.
    runtime.needs_plan = False
    texts = [c.text for c in result.content if isinstance(c, TextContent)]
    logger.debug("MCP tool %s returned %d content block(s)", tool_name, len(result.content))
    return "\n".join(texts) if texts else "(tool returned no content)"
