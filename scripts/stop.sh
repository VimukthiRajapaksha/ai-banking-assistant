#!/usr/bin/env bash
# Stops the local stack. Data (APIM's database, consents) is kept in named
# volumes; pass --purge to remove them too, which makes the next start
# re-provision APIM and the consent model from scratch.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "${ROOT}/deploy/local/docker-compose.yml")

if [ "${1:-}" = "--purge" ]; then
  "${COMPOSE[@]}" down -v
  # Purpose ids and the APIM API id point at records that no longer exist.
  # ThunderID/AMP credentials are kept: those records live in Agent Manager.
  gen="${ROOT}/deploy/local/.env.generated"
  [ -f "$gen" ] && sed -i.bak '/^MCP_CONSENT__/d;/^APIM_/d;/^MCP_OUTBOUND_API__/d' "$gen" && rm -f "${gen}.bak"
else
  "${COMPOSE[@]}" down
fi
