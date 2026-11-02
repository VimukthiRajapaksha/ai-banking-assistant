#!/usr/bin/env bash
# Mints a ThunderID management token for the provisioning client.
#
# `resource` is not optional. ThunderID issues scopes per resource indicator,
# and the server-wide defaultResourceServer is AMP's own -- so a request
# without it silently returns a token with aud=urn:wso2:amp and NO scope
# claim, which then 403s on every management call. That failure looks like a
# permissions problem and is not one.
set -euo pipefail

: "${THUNDER_BASE_URL:?set THUNDER_BASE_URL}"
: "${THUNDER_CLIENT_ID:?set THUNDER_CLIENT_ID}"
: "${THUNDER_CLIENT_SECRET:?set THUNDER_CLIENT_SECRET}"

SCOPE="${1:-system}"
RESOURCE="${2:-${THUNDER_BASE_URL}/mcp}"

response="$(curl -sf -u "${THUNDER_CLIENT_ID}:${THUNDER_CLIENT_SECRET}" \
  -d 'grant_type=client_credentials' \
  --data-urlencode "scope=${SCOPE}" \
  --data-urlencode "resource=${RESOURCE}" \
  "${THUNDER_BASE_URL}/oauth2/token")" ||
  { echo "!! token request failed -- check THUNDER_CLIENT_ID/SECRET" >&2; exit 1; }

token="$(jq -r '.access_token // empty' <<<"$response")"
[ -n "$token" ] || { echo "!! no access_token in response" >&2; exit 1; }

# A token with no scope means the client holds no role granting it. Fail here
# rather than 40 lines later on an opaque 403.
granted="$(jq -r 'if .scope then .scope else "" end' <<<"$response")"
[ -n "$granted" ] || {
  echo "!! token has no scope: assign a role granting '${SCOPE}' on ${RESOURCE} to ${THUNDER_CLIENT_ID}" >&2
  exit 1
}

printf '%s' "$token"
