"""Distributed tracing, wired to W3C Trace Context.

Replaces the hand-rolled correlation id this service used to thread through
ContextVars. That worked, but it only joined up logs within one service and
carried no timing -- so "which hop was slow" and "which of these two token
exchanges failed" were both unanswerable.

Three identifiers, each answering a different question:

  session.id  everything one user did in a sitting      (OTel semantic convention)
  trace_id    everything one question touched           (W3C `traceparent`)
  span_id     one operation inside that question        (W3C `traceparent`)

The third is what the old correlation id could not do. A single question makes
several similar calls -- two token exchanges, several bank reads -- and only a
span id tells their log lines apart.

`session.id` travels in W3C `baggage`, which propagates across services
untouched, so the browser sets it once and every downstream log carries it.
"""

from __future__ import annotations

import contextvars
from collections.abc import Iterator
from contextlib import contextmanager
import json
import logging
import os
import re
import time

from opentelemetry import baggage, context, propagate, trace
from opentelemetry.baggage.propagation import W3CBaggagePropagator
from opentelemetry.context import Context
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.propagators.composite import CompositePropagator
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import SpanProcessor, TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.sdk.trace.id_generator import RandomIdGenerator
from opentelemetry.trace import NonRecordingSpan, SpanContext, SpanKind, TraceFlags
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

logger = logging.getLogger(__name__)

SESSION_ID_KEY = "session.id"


class TraceContextFilter(logging.Filter):
    """Stamps every record with the active trace, span and session.

    Without this the logs and the traces are two separate stories about the
    same request.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        span = trace.get_current_span()
        context = span.get_span_context()
        if context.is_valid:
            record.trace_id = format(context.trace_id, "032x")
            record.span_id = format(context.span_id, "016x")
        else:
            record.trace_id = "-"
            record.span_id = "-"
        record.session_id = baggage.get_baggage(SESSION_ID_KEY) or "-"
        return True


def current_session_id() -> str | None:
    """The session id the browser put in baggage, if any."""
    value = baggage.get_baggage(SESSION_ID_KEY)
    return str(value) if value else None


def _otlp_endpoint() -> str | None:
    """Where to ship telemetry, if a collector is configured.

    AMP_OTEL_ENDPOINT is what `amp-instrument` sets. Read here too rather than
    assuming that wrapper is present: the services also run bare, and the
    signal should go to the same place either way.
    """
    endpoint = os.environ.get("AMP_OTEL_ENDPOINT", "").strip().rstrip("/")
    return endpoint or None


def _otlp_headers() -> dict[str, str]:
    """The header the AMP gateway actually reads.

    Not `Authorization` -- the gateway ignores it and returns 401 for a valid
    token exactly as it does for no token at all, which is a slow thing to
    diagnose. `x-amp-api-key` is what amp-instrument sends.
    """
    key = os.environ.get("AMP_AGENT_API_KEY", "").strip()
    return {"x-amp-api-key": key} if key else {}


# No OTLP log exporter here on purpose. The AMP gateway exposes /otel/v1/traces
# only -- every logs path 404s -- and the observer's /api/v1/logs is a *read*
# API. Runtime logs are collected from the process's stdout, so the handler in
# this service's logging setup, with its trace ids, already is the channel.


# The browser mints the traceparent (one question, one trace id), but it
# exports no spans -- so the span id it names as parent never reaches AMP. A
# trace whose top span points at a missing parent has no root, and the AMP
# console lists only traces with a root: every chat was stored and none was
# shown. This service is the edge, so it keeps the browser's trace id (browser
# logs still match) but drops the parent, making its own server span the root.
_edge_trace_id: contextvars.ContextVar[int | None] = contextvars.ContextVar(
    "edge_trace_id", default=None
)


class _RootAtEdgePropagator(TraceContextTextMapPropagator):
    """Extract the caller's trace id only, never its span as a parent."""

    def extract(self, carrier, context=None, getter=None):  # type: ignore[override]
        kwargs = {"getter": getter} if getter is not None else {}
        extracted = super().extract(carrier, context=context, **kwargs)
        caller = trace.get_current_span(extracted).get_span_context()
        base = context if context is not None else Context()
        held = _held_turn(caller.trace_id) if caller.is_valid else None
        if held is not None:
            # The answer to a consent prompt: continue under the turn that
            # asked, so every round of one question is one tree.
            _edge_trace_id.set(None)
            return trace.set_span_in_context(NonRecordingSpan(held), base)
        # Set per request: each ASGI request runs in its own task, so this
        # cannot leak into another request's root.
        _edge_trace_id.set(caller.trace_id if caller.is_valid else None)
        # The context as it was before the traceparent -- baggage survives,
        # because the composite runs the baggage propagator separately.
        return base


# Turns that stopped for consent, by trace id: the root span the answer's
# request should hang under. In-process and short-lived on purpose -- it only
# shapes telemetry, so losing it (a restart, a second replica) costs nothing
# but a split trace. Bounded so abandoned prompts cannot grow it.
_HELD_TURN_TTL_SECONDS = 15 * 60
_HELD_TURN_LIMIT = 1000
_held_turns: dict[int, tuple[SpanContext, float]] = {}


def _held_turn(trace_id: int) -> SpanContext | None:
    entry = _held_turns.get(trace_id)
    if entry is None:
        return None
    span_context, held_at = entry
    if time.monotonic() - held_at > _HELD_TURN_TTL_SECONDS:
        _held_turns.pop(trace_id, None)
        return None
    return span_context


def hold_turn_for_answer() -> None:
    """This turn is waiting on the customer: keep its trace open for the answer.

    Only the FIRST round registers. A payment asks three times; every answer
    then hangs under the question's own span, side by side, rather than each
    under the previous answer.
    """
    current = trace.get_current_span().get_span_context()
    if not current.is_valid or current.trace_id in _held_turns:
        return
    if len(_held_turns) >= _HELD_TURN_LIMIT:
        _held_turns.pop(next(iter(_held_turns)))
    _held_turns[current.trace_id] = (current, time.monotonic())


def release_turn() -> None:
    """The question is answered (or abandoned): nothing more will join it."""
    current = trace.get_current_span().get_span_context()
    if current.is_valid:
        _held_turns.pop(current.trace_id, None)


class _EdgeTraceIdGenerator(RandomIdGenerator):
    """New roots take the caller's trace id once, then fall back to random."""

    def generate_trace_id(self) -> int:
        trace_id = _edge_trace_id.get()
        if trace_id is None:
            return super().generate_trace_id()
        _edge_trace_id.set(None)
        return trace_id


def _instrument_agent_runs() -> None:
    """Emit spans for the agent's own reasoning, not just its HTTP calls.

    Without this a trace shows only "POST /chat" and the requests underneath
    it: which model was asked, what it was asked, which tool it chose and with
    what arguments are all invisible, and those are the questions anyone
    debugging an agent actually has.

    `include_content` puts the prompt, the reply and tool arguments on the
    spans. That is the point here -- but it means chat content and payment
    details reach the collector, so it is worth a deliberate decision per
    environment rather than a default. Token material never appears: it travels
    in headers, which are not captured.
    """
    try:
        from pydantic_ai import Agent
        from pydantic_ai.models.instrumented import InstrumentationSettings
    except ImportError:  # pragma: no cover - pydantic-ai is a hard dependency
        return
    include = os.environ.get("AGENT_TRACE_CONTENT", "true").strip().lower() != "false"
    # Format 6: a tool result goes in a role="tool" message, as the GenAI
    # conventions pair it. The default (5) files it under role="user" -- the
    # Anthropic wire shape -- so the console showed user -> assistant -> user
    # and the tool's answer read like something the customer typed.
    Agent.instrument_all(InstrumentationSettings(include_content=include, version=6))
    logger.debug("Agent run instrumentation enabled (content=%s)", include)


class _McpSpanLabeler(SpanProcessor):
    """Give the MCP SDK's spans names and kinds AMP's console understands.

    The console picks a span's icon from its NAME alone (the tree is drawn from
    a span list that carries no attributes) and recognises only the GenAI
    prefixes -- `execute_tool ...`, `execute_task ...`, `invoke_agent ...`. The
    SDK names its spans after the JSON-RPC method, so every MCP span drew the
    "unknown" icon. Renamed at start, while the span is still writable.
    """

    def on_start(self, span, parent_context=None) -> None:
        attrs = span.attributes or {}
        method = attrs.get("mcp.method.name")
        if not method:
            return
        tool = attrs.get("gen_ai.tool.name")
        if span.kind is SpanKind.SERVER and method == "tools/call" and tool:
            # Where the tool actually runs; the SDK already marks it
            # execute_tool, only the name was missing.
            span.update_name(f"execute_tool {tool}")
            span.set_attribute("traceloop.span.kind", "tool")
            return
        side = "send" if span.kind is SpanKind.CLIENT else "handle"
        # The client span has no gen_ai.tool.name; the SDK only put the
        # target in its name ("MCP send tools/call get_accounts").
        target = f" {tool}" if tool else span.name.partition(method)[2].rstrip()
        span.update_name(f"execute_task MCP {side} {method}{target}")
        span.set_attribute("traceloop.span.kind", "task")


# Hosts this stack calls, by what they ARE rather than where they live.
_SERVICE_NAMES = {
    "thunder.amp.localhost": "ThunderID",
    "consent-server": "consent",
    "apim": "bank",
    "mcp-server": "MCP",
    "default-default.gateway.localhost": "AMP gateway",
}
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)
_API_PREFIX = re.compile(r"^/(?:api/v\d+(?:\.\d+)*|bank/v\d+(?:\.\d+)*)")


def _http_span_name(method: str, url) -> str:
    """`GET bank /accounts`, not `GET`: which service, which resource.

    Ids are templated out (`/consents/{id}`), so the name names an operation
    rather than one record -- the concrete URL stays on the span as
    `http.url`. Prefixed `execute_task` because AMP's console picks a span's
    icon from that prefix and has no HTTP kind of its own.
    """
    host = getattr(url, "host", "") or ""
    path = getattr(url, "path", "") or "/"
    service = _SERVICE_NAMES.get(host, host)
    path = _UUID.sub("{id}", _API_PREFIX.sub("", path)) or "/"
    return f"execute_task {method} {service} {path}"


def _name_http_span(span, request) -> None:
    if span is None or not span.is_recording():
        return
    method = request.method.decode() if isinstance(request.method, bytes) else str(request.method)
    span.update_name(_http_span_name(method, request.url))
    span.set_attribute("traceloop.span.kind", "task")


async def _name_http_span_async(span, request) -> None:
    _name_http_span(span, request)


def record_turn(message: str, reply: str, *, final: bool) -> None:
    """Put the customer's question and the reply on this request's span.

    `gen_ai.*.messages` is what the span details pane reads. The trace LIST
    reads only `traceloop.entity.*` on the root and otherwise falls back to the
    trace's LLM calls -- whose input is the whole conversation, so a trace was
    listed under an earlier question. Hence both.

    `final` is False when the turn stopped for the customer (a consent
    prompt). The root's output is then left unset: the real answer arrives in
    a later request, hung under this root, and with no output here the list
    takes the trace's last model reply -- which is that answer. Same switch as
    the model spans: AGENT_TRACE_CONTENT=false records nothing.
    """
    if os.environ.get("AGENT_TRACE_CONTENT", "true").strip().lower() == "false":
        return
    span = trace.get_current_span()
    if not span.is_recording():
        return
    span.set_attribute(
        "gen_ai.input.messages",
        json.dumps([{"role": "user", "parts": [{"type": "text", "content": message}]}]),
    )
    span.set_attribute(
        "gen_ai.output.messages",
        json.dumps([{"role": "assistant", "parts": [{"type": "text", "content": reply}]}]),
    )
    span.set_attribute("traceloop.entity.input", message)
    if final:
        span.set_attribute("traceloop.entity.output", reply)


@contextmanager
def untraced() -> Iterator[None]:
    """Run a block in this trace without recording any of it -- here or downstream.

    The block's parent is marked not-sampled, so the parent-based sampler drops
    every span under it, and the traceparent sent on is not-sampled too: the
    MCP server, also parent-based, records nothing for those calls either. Log
    lines keep the trace id. For plumbing such as MCP discovery, which
    otherwise buried each turn's trace under spans nobody reads.
    """
    current = trace.get_current_span().get_span_context()
    if not current.is_valid:
        yield
        return
    unsampled = SpanContext(
        current.trace_id, current.span_id, is_remote=False, trace_flags=TraceFlags(TraceFlags.DEFAULT)
    )
    token = context.attach(trace.set_span_in_context(NonRecordingSpan(unsampled)))
    try:
        yield
    finally:
        context.detach(token)


def setup_tracing(service_name: str, *, console_spans: bool = False) -> None:
    """Install tracing and auto-instrument HTTP in and out.

    Auto-instrumentation is what makes this nearly free: every inbound request
    and outbound httpx call becomes a span with `traceparent` propagated, so
    the only spans worth adding by hand are the non-HTTP ones.
    """
    # A wrapper such as `amp-instrument` installs its own provider before this
    # runs. Replacing it silently drops every span it would have exported --
    # which is exactly what happened: ours had no exporter attached.
    existing = trace.get_tracer_provider()
    if isinstance(existing, TracerProvider):
        provider = existing
        provider.id_generator = _EdgeTraceIdGenerator()
        logger.debug("Reusing the tracer provider already installed")
    else:
        provider = TracerProvider(
            resource=Resource.create({"service.name": service_name}),
            id_generator=_EdgeTraceIdGenerator(),
        )
        endpoint = _otlp_endpoint()
        if endpoint is not None:
            provider.add_span_processor(
                BatchSpanProcessor(
                    OTLPSpanExporter(endpoint=f"{endpoint}/v1/traces", headers=_otlp_headers())
                )
            )
        if console_spans:
            provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
        trace.set_tracer_provider(provider)
    propagate.set_global_textmap(
        CompositePropagator([_RootAtEdgePropagator(), W3CBaggagePropagator()])
    )
    provider.add_span_processor(_McpSpanLabeler())
    HTTPXClientInstrumentor().instrument(
        request_hook=_name_http_span, async_request_hook=_name_http_span_async
    )
    _instrument_agent_runs()
    logger.debug("Tracing enabled for %s", service_name)


def instrument_app(app) -> None:
    """Instrument a FastAPI app. Imported lazily: the MCP server is Starlette
    and has no FastAPI dependency, so importing it at module scope would break
    that service for a function it never calls."""
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    FastAPIInstrumentor.instrument_app(
        app,
        server_request_hook=_label_agent_invocation,
        # One span per ASGI message ("POST /chat http send", "... receive")
        # times the body chunks: transport detail that buried the trace.
        exclude_spans=["receive", "send"],
    )


# Paths that are one turn of the agent, as opposed to plumbing like passkeys.
_AGENT_INVOCATION_PATHS = frozenset({"/chat"})


def _label_agent_invocation(span, scope) -> None:
    """Tell AMP that a chat request's root span IS the agent run.

    AMP's console classifies a trace by its root span's attributes and finds
    none on a bare HTTP server span, so every chat was listed as "UNKNOWN".
    `traceloop.span.kind` is what it checks first; the GenAI pair is the
    OTel-standard way to say the same thing, so other backends read it too.

    Renamed as well: the trace tree picks its icon from the span NAME, not its
    attributes, so "POST /chat" drew a question mark even while the details
    pane said AGENT. `invoke_agent {name}` is the GenAI convention it matches.
    The HTTP method and route stay on the span as attributes.
    """
    if span is None or not span.is_recording() or scope.get("path") not in _AGENT_INVOCATION_PATHS:
        return
    name = os.environ.get("AMP_AGENT_NAME", "ai-banking-agent")
    # A parent here means this request answers a consent prompt (see
    # _RootAtEdgePropagator); say so, keeping the prefix the icon needs.
    resumed = getattr(span, "parent", None) is not None
    span.update_name(f"invoke_agent {name}" + (" (after customer input)" if resumed else ""))
    span.set_attribute("traceloop.span.kind", "agent")
    span.set_attribute("gen_ai.operation.name", "invoke_agent")
    span.set_attribute("gen_ai.agent.name", name)


def instrument_asgi(app):
    """Wrap a bare ASGI app so inbound requests CONTINUE the caller's trace.

    Without this the service would start a fresh trace per request, and a
    question would appear as several unrelated traces instead of one.
    """
    from opentelemetry.instrumentation.asgi import OpenTelemetryMiddleware

    return OpenTelemetryMiddleware(app)
