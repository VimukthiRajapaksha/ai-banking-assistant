#!/usr/bin/env bash
# Checks everything the local stack needs before `scripts/start.sh`.
# Exits non-zero on the first category that fails, naming what to fix.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/deploy/local/.env"
fail=0

ok()   { printf '  ok    %s\n' "$*"; }
bad()  { printf '  FAIL  %s\n' "$*"; fail=1; }
warn() { printf '  warn  %s\n' "$*"; }

echo "Tools"
for tool in docker git curl jq; do
  command -v "$tool" >/dev/null && ok "$tool" || bad "$tool is not installed"
done
docker info >/dev/null 2>&1 && ok "docker daemon is running" || bad "docker daemon is not reachable"
docker compose version >/dev/null 2>&1 && ok "docker compose v2" || bad "docker compose v2 is not available"

echo "Configuration"
if [ -f "$ENV_FILE" ]; then
  ok "deploy/local/.env exists"
  for key in THUNDER_BASE_URL THUNDER_CLIENT_ID THUNDER_CLIENT_SECRET AMP_BASE_URL ANTHROPIC_API_KEY APEX_USER_PASSWORD; do
    val="$(grep -m1 "^${key}=" "$ENV_FILE" | cut -d= -f2-)"
    case "$val" in
      ""|"<"*) bad "${key} is not set in deploy/local/.env" ;;
      *) ok "${key} is set" ;;
    esac
  done
else
  bad "deploy/local/.env is missing: cp deploy/local/.env.example deploy/local/.env"
fi

echo "OpenFGC checkout"
[ -d "${ROOT}/deploy/local/external/openfgc/consent-server" ] && ok "deploy/local/external/openfgc" ||
  bad "OpenFGC is not fetched: scripts/fetch-openfgc.sh"

echo "WSO2 Agent Manager (must already be running)"
# curl resolves *.localhost to loopback by itself, which is where AMP's k3d
# ports are published.
code="$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://thunder.amp.localhost:8080/.well-known/openid-configuration)"
[ "$code" = "200" ] && ok "ThunderID at http://thunder.amp.localhost:8080" ||
  bad "ThunderID is not answering at http://thunder.amp.localhost:8080 (HTTP ${code}); start Agent Manager"
code="$(curl -s -o /dev/null -w '%{http_code}' -m 5 http://localhost:9000/healthz)"
[ "$code" = "200" ] && ok "AMP API at http://localhost:9000" ||
  bad "AMP API is not answering at http://localhost:9000/healthz (HTTP ${code})"

echo "Host ports the stack publishes"
for port in 80 8243 8280 9443 18000 18010 18020 18030 18040 18050 18060; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    owner="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN | awk 'NR==2{print $1}')"
    case "$owner" in
      com.docke*|docker*|vpnkit*|limactl*|ssh*) warn "port ${port} is in use by ${owner} (fine if it is this stack)" ;;
      *) bad "port ${port} is in use by ${owner}" ;;
    esac
  fi
done

[ "$fail" = 0 ] && echo "All checks passed." || echo "Fix the failures above, then re-run."
exit "$fail"
