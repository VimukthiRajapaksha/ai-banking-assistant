#!/usr/bin/env bash
# Provisions and starts the local stack.
#
# Two phases, because Compose reads every service's env_file when it creates
# the containers -- before any init service has run. Starting everything at
# once on a fresh checkout would create the agent and MCP server without the
# credentials the provisioners are about to write.
#
#   1. the init services (and what they need: APIM, the consent server, the
#      mock bank), which write deploy/local/.env.generated;
#   2. everything else, created after that file exists so it is read.
#
# Safe to re-run: every provisioner adopts what already exists.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "${ROOT}/deploy/local/docker-compose.yml")

# Per-service settings: each env/<service>.env is created from its committed
# .env.example on first run, then left alone so local edits survive.
for example in "${ROOT}"/deploy/local/env/*.env.example; do
  [ -f "${example%.example}" ] || cp "$example" "${example%.example}"
done

"${ROOT}/scripts/fetch-openfgc.sh"
"${ROOT}/scripts/check-prereqs.sh"

echo "==> provisioning (ThunderID, AMP, APIM, consent); APIM takes a few minutes to boot"
# Attached to the init services only, so this returns once all four have
# exited; APIM, the consent server and the mock bank keep running behind them.
"${COMPOSE[@]}" up --build thunder-init amp-init consent-init apim-init ||
  { echo "!! provisioning failed -- see the output above" >&2; exit 1; }

for svc in thunder-init amp-init consent-init apim-init; do
  code="$("${COMPOSE[@]}" ps -a --format '{{.ExitCode}}' "$svc")"
  [ "$code" = "0" ] || { echo "!! ${svc} exited ${code}: ${COMPOSE[*]} logs ${svc}" >&2; exit 1; }
done

echo "==> starting the services"
# --no-deps: the provisioners have already run, and naming them as
# dependencies again would start them a second time.
"${COMPOSE[@]}" up -d --build --no-deps \
  mock-backend mcp-server agent ui consent-bff consent-portal caddy

"${ROOT}/scripts/doctor.sh" --wait
cat <<'MSG'

Open http://portal.apex.localhost and sign in as alex@apexbank.com with
APEX_USER_PASSWORD from deploy/local/.env.
MSG
