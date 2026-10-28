def main() -> None:
    import uvicorn

    from ai_banking_agent.logging_context import configure_logging
    from ai_banking_agent.settings import get_settings
    from ai_banking_agent.telemetry import setup_tracing

    setup_tracing("ai-banking-agent")
    configure_logging()
    settings = get_settings()
    uvicorn.run("ai_banking_agent.server:app", host=settings.runtime.host, port=settings.runtime.port)
