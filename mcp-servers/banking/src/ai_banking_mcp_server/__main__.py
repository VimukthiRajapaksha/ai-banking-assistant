import logging

from mcp.server import MCPServer
from mcp.server.transport_security import TransportSecuritySettings

from ai_banking_mcp_server.server import build
from ai_banking_mcp_server.settings import Settings, get_settings
from ai_banking_mcp_server.telemetry import (
    TraceContextFilter,
    instrument_asgi,
    setup_tracing,
)

logger = logging.getLogger(__name__)


def main() -> None:
    setup_tracing("ai-banking-mcp-server")
    handler = logging.StreamHandler()
    handler.addFilter(TraceContextFilter())
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s "
            "[session=%(session_id)s trace=%(trace_id)s span=%(span_id)s] "
            "%(name)s: %(message)s"
        )
    )
    logging.basicConfig(level=logging.DEBUG, handlers=[handler], force=True)
    settings: Settings = get_settings()

    mcp: MCPServer = build(settings=settings)
    logger.info("Starting AI banking MCP server on %s:%s", settings.runtime.host, settings.runtime.port)

    # Run the ASGI app directly rather than mcp.run(), so inbound requests can
    # be wrapped and continue the caller's trace instead of starting a new one.
    import uvicorn

    # `host` here is NOT a bind address -- uvicorn below does the binding. It
    # only tells the SDK whether to auto-enable DNS-rebinding protection, and
    # passing our own settings takes that decision away from it entirely.
    app = mcp.streamable_http_app(
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=settings.runtime.allowed_hosts,
            allowed_origins=[f"http://{h}" for h in settings.runtime.allowed_hosts],
        )
    )
    uvicorn.run(
        instrument_asgi(app),
        host=settings.runtime.host,
        port=settings.runtime.port,
        log_config=None,  # keep our trace-stamped formatter
    )


if __name__ == "__main__":
    main()
