"""Log formatting, keyed on the active trace.

Identifiers no longer come from ContextVars this service manages. They come
from the active OpenTelemetry span and from W3C baggage, so the same values
appear in every service's logs and in the traces, without anyone threading
them through function calls by hand. See telemetry.py for what each one means.
"""

from __future__ import annotations

import logging
import os

from ai_banking_agent.telemetry import TraceContextFilter


def configure_logging(level: int | None = None) -> None:
    """Install the trace-stamped handler.

    The level comes from AGENT_LOG_LEVEL when set. Worth having as a knob
    rather than a constant: at INFO the OTLP exporter is completely silent, so
    "are spans actually leaving this process?" is unanswerable from the logs --
    which is exactly the question that matters when telemetry looks missing.
    """
    if level is None:
        name = os.environ.get("AGENT_LOG_LEVEL", "INFO").strip().upper()
        level = getattr(logging, name, logging.INFO)
    handler = logging.StreamHandler()
    handler.addFilter(TraceContextFilter())
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)s "
            "[session=%(session_id)s trace=%(trace_id)s span=%(span_id)s] "
            "%(name)s: %(message)s"
        )
    )
    logging.basicConfig(level=level, handlers=[handler], force=True)
