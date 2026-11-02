#!/usr/bin/env bash
# Health of every hop in the local stack. --wait retries for up to two minutes
# (services that just started need a moment); without it, one pass.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tries=1
[ "${1:-}" = "--wait" ] && tries=24

check() { # name url [expected-codes]
  local name="$1" url="$2" want="${3:-200}" code i
  for ((i = 1; i <= tries; i++)); do
    code="$(curl -sk -o /dev/null -w '%{http_code}' -m 5 "$url")"
    case " $want " in *" $code "*) printf '  ok    %-26s %s\n' "$name" "$url"; return 0 ;; esac
    [ "$i" -lt "$tries" ] && sleep 5
  done
  printf '  FAIL  %-26s %s (HTTP %s)\n' "$name" "$url" "$code"
  return 1
}

fail=0
echo "External"
check "ThunderID (AMP)"        http://thunder.amp.localhost:8080/.well-known/openid-configuration || fail=1
check "AMP API"                http://localhost:9000/healthz || fail=1
echo "Stack"
check "mock bank"              http://localhost:18030/health || fail=1
check "consent server"         http://localhost:18040/health/readiness || fail=1
# No token: the gateway is up and the API deployed when it answers 401, not 404.
check "APIM gateway (bank API)" https://localhost:8243/bank/v1.0/products "200 401" || fail=1
# Unauthenticated: up when it refuses the request, rather than not answering.
check "MCP server"             http://localhost:18010/mcp "400 401 405 406" || fail=1
check "agent"                  http://localhost:18020/openapi.json || fail=1
check "bank portal"            http://portal.apex.localhost/ || fail=1
check "consent portal"         http://portal.consent.apex.localhost/ || fail=1

[ "$fail" = 0 ] && echo "All hops healthy." || echo "Some hops failed: docker compose -f deploy/local/docker-compose.yml logs <service>"
exit "$fail"
