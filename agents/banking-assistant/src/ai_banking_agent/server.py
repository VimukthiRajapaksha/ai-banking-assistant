"""FastAPI app: the conversational /chat endpoint.

The caller presents a token scoped to this agent's API. That token is exchanged
-- non-interactively, presenting this agent's own actor_token -- for one scoped
to the MCP server, carrying `sub` = the end user and `act.sub` = this agent.
There is no browser redirect and no authorization prompt on this leg; see
identity/token_exchange.py.

The bank's own authorization (handled inside the MCP server) still uses the
return-a-link-and-continue pattern: the user completes it in their browser and
the next message proceeds, rather than this service blocking or polling.

Assumes /chat sits behind a security gateway that has already validated the
caller's token; this agent does not re-verify it, but it does need the raw token
to use as the exchange's subject.
"""

from __future__ import annotations

import logging
import secrets
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pydantic_ai import Agent
from pydantic_graph import End
from starlette.requests import Request

from ai_banking_agent.chat_agent import build_chat_agent, parse_plan, strip_plan
from ai_banking_agent.identity.jwt_utils import decode_claims
from ai_banking_agent.identity.self_auth import AgentIdentity, AgentSelfAuthError
from ai_banking_agent.identity.token_exchange import (
    DelegatedExchangeError,
    exchange_for_mcp_token,
)
from ai_banking_agent.identity.token_verifier import CustomerTokenVerifier
from ai_banking_agent.mcp_client import ConsentRequired, turn_connection
from ai_banking_agent.security import build_router as build_security_router
from ai_banking_agent.sessions import ElicitationResponse, SessionStore
from ai_banking_agent.settings import get_settings
from ai_banking_agent.telemetry import hold_turn_for_answer, instrument_app, record_turn, release_turn

logger = logging.getLogger(__name__)


class ElicitationAnswer(BaseModel):
    """The user's answer to a consent form, relayed verbatim to the MCP server."""

    key: str
    action: str = "accept"
    content: dict | None = None


class ChatRequest(BaseModel):
    session_id: str | None = None
    message: str | None = None
    elicitation_response: ElicitationAnswer | None = None


class ConsentForm(BaseModel):
    key: str
    message: str
    # The consent record awaiting the user's approval. The frontend approves it
    # directly against the consent service under the user's own identity --
    # neither this agent nor the MCP server may approve on their behalf.
    consent_id: str | None = None
    schema_: dict = Field(default_factory=dict, alias="schema")

    model_config = {"populate_by_name": True}


class ChatResponse(BaseModel):
    session_id: str
    reply: str
    status: str  # "ok" | "awaiting_consent"
    # Set when status is awaiting_consent -- the form the UI should render.
    elicitation: ConsentForm | None = None


def _root_cause(exc: BaseException) -> BaseException:
    """The innermost real exception inside an ExceptionGroup.

    The MCP SDK runs its transport inside an anyio task group, so any transport
    failure surfaces as an ExceptionGroup whose str() is the useless
    "unhandled errors in a TaskGroup (1 sub-exception)" -- identical whether
    the server is unreachable, the TLS handshake failed, or the stream dropped
    mid-call. The cause is one level down, and nobody was looking.
    """
    while isinstance(exc, BaseExceptionGroup) and exc.exceptions:
        exc = exc.exceptions[0]
    return exc


def _user_facing(exc: BaseException) -> str:
    """What to tell the customer.

    A connection failure means the request never ran, and saying so matters
    most when the request was a payment: "something went wrong" leaves them
    unsure whether money moved.
    """
    if isinstance(exc, httpx.TransportError | ConnectionError):
        return "I can't reach the banking service right now, so nothing was done. Please try again in a moment."
    return f"Sorry, something went wrong: {exc}"


def _bearer_token(request: Request) -> str:
    """The caller's token, used as the subject of the delegated exchange.

    Not verified here -- the gateway in front of this service has already done
    that -- but its absence is a client error worth failing loudly on rather
    than discovering as a confusing exchange failure.
    """
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return token


async def _run_turn(chat_agent, message: str, runtime):
    """One agent turn, driven a node at a time so the turn's tool plan can be
    read off the model response *before* its tool calls run.

    That ordering is the reason this is not a plain `chat_agent.run(...)`: the
    first tool call is what asks the MCP server for consent, and the server
    must already know the full set of tools the turn needs or the customer is
    prompted once per tool. `run()` is itself `async with self.iter(...)`
    driving `next()` (pydantic_ai/agent/abstract.py), so the run span,
    capability hooks and message history are identical either way.
    """
    async with chat_agent.iter(message, message_history=runtime.message_history, deps=runtime) as run:
        node = run.next_node
        while not isinstance(node, End):
            # A capability may short-circuit the run, leaving a result with
            # nodes still pending; mirrors what Agent.run() does.
            if run.result is not None:
                break
            # Only until a tool has succeeded: from then on consent exists and
            # a plan changes nothing.
            if runtime.needs_plan and Agent.is_call_tools_node(node):
                runtime.planned_tools = parse_plan(node.model_response)
                logger.debug("Planned tools: %s", runtime.planned_tools or "(none)")
            node = await run.next(node)
    assert run.result is not None, "the agent run did not finish"
    return run.result


def build_app() -> FastAPI:
    settings = get_settings()
    agent_identity = AgentIdentity(settings.identity)
    chat_agent = build_chat_agent(
        settings.llm.model,
        settings.llm.anthropic_api_key.get_secret_value(),
        str(settings.mcp.server_url),
        settings.llm.base_url,
        settings.llm.api_key_header,
    )
    session_store = SessionStore()

    app = FastAPI(title="AI Banking Agent")
    # Every inbound request and outbound httpx call becomes a span, with
    # traceparent propagated, so the trace spans all three services.
    instrument_app(app)

    # The UI calls /chat directly from the browser (Bearer token, JSON body),
    # which requires a CORS preflight to succeed -- without this, the
    # frontend's fetch() is blocked before the request is ever sent.
    origin = urlparse(str(settings.frontend.origin))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[f"{origin.scheme}://{origin.netloc}"],
        allow_methods=["POST"],
        # traceparent/baggage are sent by the browser on every call, so they
        # must be allowed here or the preflight fails and the request never
        # reaches this service -- which shows up as an opaque NetworkError in
        # the UI, with nothing logged here to explain it.
        allow_headers=["Authorization", "Content-Type", "traceparent", "tracestate", "baggage"],
    )

    # Passkey enrolment. Separate module because it is the one thing here that
    # verifies the customer's token rather than forwarding it -- see
    # security.py for why that distinction matters.
    app.include_router(
        build_security_router(
            verifier=CustomerTokenVerifier(
                jwks_uri=settings.identity.jwks_uri,
                issuer=settings.identity.issuer,
                audience=settings.security.audience,
            ),
            thunder_base_url=settings.identity.base_url,
            application_id=settings.security.application_id,
            flow_secret=settings.security.flow_secret.get_secret_value(),
            # ID tokens are issued to the portal, so that is the audience they
            # must carry to be believed.
            portal_client_id=settings.security.portal_client_id,
            max_auth_age_seconds=settings.security.max_auth_age_seconds,
        )
    )

    @app.post("/chat", response_model=ChatResponse)
    async def chat(req: ChatRequest, request: Request) -> ChatResponse:
        response = await _chat(req, request)
        record_turn(req.message or "", response.reply, final=response.status != "awaiting_consent")
        if response.status == "awaiting_consent":
            hold_turn_for_answer()
        else:
            release_turn()
        return response

    async def _chat(req: ChatRequest, request: Request) -> ChatResponse:
        subject_token = _bearer_token(request)
        session_id = req.session_id or secrets.token_urlsafe(16)
        logger.info("Chat request received")

        # Unverified decode: the gateway in front of this service has already
        # validated the signature. Used only to bind the session to an identity,
        # never to make an authorization decision.
        subject = decode_claims(subject_token).get("sub") or ""
        if not subject:
            raise HTTPException(status_code=401, detail="Token has no subject")
        try:
            runtime = session_store.get_or_create(session_id, subject)
        except PermissionError:
            logger.warning("Rejected session replay under a different subject")
            raise HTTPException(status_code=403, detail="Session does not belong to this user") from None

        if req.elicitation_response is not None:
            # Routed to the tool that raised this form. Without that, a turn
            # with two outstanding forms delivers the answer to whichever tool
            # the model happens to call first.
            answered_tool = runtime.elicitation_tool.get(req.elicitation_response.key)
            if answered_tool is None:
                logger.warning("Ignoring an answer to a form this session did not ask for")
            else:
                runtime.pending_elicitation[answered_tool] = ElicitationResponse(
                    key=req.elicitation_response.key,
                    action=req.elicitation_response.action,
                    content=req.elicitation_response.content,
                )

        async with runtime.turn_lock:
            if not req.message:
                return ChatResponse(
                    session_id=session_id,
                    reply="Hi! I can help with your bank account -- what would you like to know?",
                    status="ok",
                )

            # Delegation: obtain (or refresh) a token this agent can present to
            # the MCP server on the user's behalf. Non-interactive, so it costs
            # the user nothing and needs no prompt.
            if runtime.needs_delegated_token():
                try:
                    actor_token = await agent_identity.get_actor_token()
                    # Kept for the MCP server: it cannot build the three-level
                    # act chain without a token issued to this agent.
                    runtime.actor_token = actor_token
                    runtime.delegated_token = await exchange_for_mcp_token(
                        token_endpoint=settings.identity.token_endpoint,
                        client_id=settings.identity.client_id,
                        client_secret=settings.identity.client_secret.get_secret_value(),
                        subject_token=subject_token,
                        actor_token=actor_token,
                        audience=settings.mcp.audience,
                        scope=settings.mcp.scopes,
                    )
                except AgentSelfAuthError as exc:
                    logger.exception("agent self-auth failed")
                    return ChatResponse(
                        session_id=session_id, reply=f"Agent is unable to authenticate itself: {exc}", status="ok"
                    )
                except DelegatedExchangeError as exc:
                    logger.exception("delegated token exchange failed")
                    return ChatResponse(
                        session_id=session_id, reply=f"Agent is unable to act on your behalf: {exc}", status="ok"
                    )

            try:
                async with turn_connection(str(settings.mcp.server_url), runtime):
                    result = await _run_turn(chat_agent, req.message, runtime)
            except ConsentRequired as exc:
                logger.info("Consent required for this request")
                runtime.elicitation_tool[exc.key] = exc.tool
                return ChatResponse(
                    session_id=session_id,
                    reply=exc.message,
                    status="awaiting_consent",
                    elicitation=ConsentForm(
                        key=exc.key, message=exc.message, schema=exc.schema,
                        consent_id=exc.consent_id,
                    ),
                )
            except Exception as exc:
                cause = _root_cause(exc)
                # Log the unwrapped cause: the group itself names no host, no
                # port and no error code, so the log was as opaque as the reply.
                logger.warning("agent turn failed: %s: %s", type(cause).__name__, cause, exc_info=cause)
                return ChatResponse(session_id=session_id, reply=_user_facing(cause), status="ok")

            runtime.message_history = result.all_messages()
            return ChatResponse(session_id=session_id, reply=strip_plan(result.output), status="ok")

    return app


app = build_app()
