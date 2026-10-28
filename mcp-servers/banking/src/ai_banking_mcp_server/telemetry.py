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

import json
import logging
import os
import re

from opentelemetry import baggage, context, propagate, trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import SpanProcessor, TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ConsoleSpanExporter
from opentelemetry.trace import SpanKind

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


class ToolIOMiddleware:
    """Record a tool call's arguments and result on the SDK's tool span.

    The SDK's span says which tool ran and nothing about what it was asked or
    answered, so the console showed the request and no response. These are the
    GenAI attributes the console reads for a tool's input and output panels.
    Registered after the SDK's OpenTelemetryMiddleware, so the current span is
    that tool span. MCP_TRACE_CONTENT=false keeps account data off the
    collector, as AGENT_TRACE_CONTENT does in the agent.
    """

    def __init__(self) -> None:
        self._enabled = os.environ.get("MCP_TRACE_CONTENT", "true").strip().lower() != "false"

    async def __call__(self, ctx, call_next):
        if not self._enabled or ctx.method != "tools/call":
            return await call_next(ctx)
        span = trace.get_current_span()
        arguments = (ctx.params or {}).get("arguments") or {}
        span.set_attribute("gen_ai.tool.call.arguments", json.dumps(arguments, default=str))
        result = await call_next(ctx)
        span.set_attribute("gen_ai.tool.call.result", _tool_result_text(result))
        return result


def _tool_result_text(result) -> str:
    """The tool's answer as text -- or, for a consent prompt, what was asked.

    Middleware sees the result as the SDK will serialise it: usually a plain
    dict in wire shape (`content`, `inputRequests`), sometimes the model.
    """
    if hasattr(result, "model_dump"):
        result = result.model_dump(by_alias=True, exclude_none=True)
    if not isinstance(result, dict):
        return type(result).__name__
    if "content" in result:
        texts = [block.get("text", "") for block in result.get("content") or [] if isinstance(block, dict)]
        return "\n".join(t for t in texts if t) or "(no text content)"
    requests = result.get("inputRequests") or result.get("input_requests") or {}
    if requests:
        messages = [(r.get("params") or {}).get("message", "") for r in requests.values() if isinstance(r, dict)]
        return "awaiting user input: " + ("; ".join(m for m in messages if m) or "(no message)")
    return json.dumps(result, default=str)[:2000]


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
        logger.debug("Reusing the tracer provider already installed")
    else:
        provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
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
    provider.add_span_processor(_McpSpanLabeler())
    HTTPXClientInstrumentor().instrument(
        request_hook=_name_http_span, async_request_hook=_name_http_span_async
    )
    logger.debug("Tracing enabled for %s", service_name)


def instrument_app(app) -> None:
    """Instrument a FastAPI app. Imported lazily: the MCP server is Starlette
    and has no FastAPI dependency, so importing it at module scope would break
    that service for a function it never calls."""
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

    FastAPIInstrumentor.instrument_app(app)


def instrument_asgi(app):
    """Wrap a bare ASGI app so inbound requests CONTINUE the caller's trace.

    Carries the caller's trace context and baggage into the request, so log
    lines keep the trace and session ids, but opens no span of its own: the
    HTTP hop (`POST /mcp`) was a span per MCP message that said nothing the
    SDK's own span for that message -- `execute_tool get_accounts` and the
    like, parented from the request's `_meta` -- does not already say.
    """

    async def with_caller_context(scope, receive, send):
        if scope.get("type") != "http":
            await app(scope, receive, send)
            return
        carrier = {k.decode("latin-1"): v.decode("latin-1") for k, v in scope.get("headers") or []}
        token = context.attach(propagate.extract(carrier))
        try:
            await app(scope, receive, send)
        finally:
            context.detach(token)

    return with_caller_context
