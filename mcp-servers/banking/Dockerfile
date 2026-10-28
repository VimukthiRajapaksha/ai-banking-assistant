# syntax=docker/dockerfile:1
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

# Dependencies first: this layer is cached until pyproject/uv.lock change.
COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

COPY src ./src
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev

ENV PATH="/app/.venv/bin:$PATH"

# Numeric, in 10000-20000: the WSO2 Developer Platform requires a non-root user
# in that range, and Kubernetes can only verify runAsNonRoot from a numeric UID.
RUN useradd --uid 10014 --no-create-home --home-dir /nonexistent \
      --shell /usr/sbin/nologin apex
USER 10014

EXPOSE 18010
CMD ["ai-banking-mcp-server"]
