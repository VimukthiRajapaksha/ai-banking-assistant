#!/usr/bin/env bash
# Publishes the bank API on WSO2 API Manager, with the scopes ThunderID issues.
#
# APIM is the enforcement point in front of the bank: it validates the bearer
# token and checks the scope attached to each resource. The scope strings here
# must match what ThunderID puts in a token exactly -- a mismatch passes the
# IdP and then fails at the gateway with a 403 that names neither side.
#
# Idempotent: the API is looked up by name+version and adopted if present.
# Re-publishing an already-published API is a no-op rather than an error.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT_FILE:-${HERE}/../.env.generated}"

APIM_BASE_URL="${APIM_BASE_URL:-https://apim:9443}"
APIM_USER="${APIM_USER:-admin}"
APIM_PASSWORD="${APIM_PASSWORD:-admin}"
API_NAME="${APIM_API_NAME:-ApexBankAPI}"
API_VERSION="${APIM_API_VERSION:-v1.0}"
API_CONTEXT="${APIM_API_CONTEXT:-/bank}"
BACKEND_URL="${APIM_BACKEND_URL:-http://mock-backend:18030}"
THUNDER_BASE_URL="${THUNDER_BASE_URL:?set THUNDER_BASE_URL in .env}"

say() { printf '==> %s\n' "$*"; }
die() { printf '!! %s\n' "$*" >&2; exit 1; }

# APIM serves its own self-signed certificate; -k is deliberate and local-only.
api() { curl -sk -m 60 "$@"; }

# ------------------------------------------------------------------- token
# APIM has no long-lived admin credential for its REST APIs: a client is
# registered through DCR first, then exchanged for a token. Both are cheap and
# idempotent -- re-registering the same clientName returns the same client.
say "registering a provisioning client"
dcr="$(api -X POST "${APIM_BASE_URL}/client-registration/v0.17/register" \
  -u "${APIM_USER}:${APIM_PASSWORD}" -H 'Content-Type: application/json' \
  -d '{"callbackUrl":"http://localhost","clientName":"apex_provisioner","owner":"'"${APIM_USER}"'","grantType":"client_credentials password refresh_token","saasApp":true}')" ||
  die "DCR failed -- is APIM up at ${APIM_BASE_URL}?"

CID="$(jq -r '.clientId // empty' <<<"$dcr")"
CSEC="$(jq -r '.clientSecret // empty' <<<"$dcr")"
[ -n "$CID" ] && [ -n "$CSEC" ] || die "DCR returned no client credentials: $(head -c 200 <<<"$dcr")"

SCOPES="apim:api_create apim:api_publish apim:api_view apim:api_manage apim:admin apim:environment_read apim:subscribe apim:app_manage apim:sub_manage"
TOKEN="$(api -u "${CID}:${CSEC}" -d grant_type=password \
  -d "username=${APIM_USER}" -d "password=${APIM_PASSWORD}" \
  --data-urlencode "scope=${SCOPES}" "${APIM_BASE_URL}/oauth2/token" |
  jq -r '.access_token // empty')"
[ -n "$TOKEN" ] || die "could not obtain an APIM token"
auth=(-H "Authorization: Bearer ${TOKEN}")

PUB="${APIM_BASE_URL}/api/am/publisher/v4"

# --------------------------------------------------------------------- api
existing="$(api "${auth[@]}" "${PUB}/apis?query=name:${API_NAME}" |
            jq -r --arg v "$API_VERSION" '.list[]? | select(.version == $v) | .id // empty' | head -1)"

if [ -n "$existing" ]; then
  say "API ${API_NAME} ${API_VERSION} exists (${existing})"
  API_ID="$existing"
else
  say "creating API ${API_NAME} ${API_VERSION}"
  # Every operation carries the scope that guards it. `scopes` at the top level
  # declares them; `operations[].scopes` binds each to a resource.
  payload="$(jq -n \
    --arg name "$API_NAME" --arg version "$API_VERSION" \
    --arg context "$API_CONTEXT" --arg backend "$BACKEND_URL" \
    '{
      name: $name, version: $version, context: $context,
      description: "Apex bank resource APIs",
      lifeCycleStatus: "CREATED", type: "HTTP", transport: ["http","https"],
      policies: ["Unlimited"],
      endpointConfig: {
        endpoint_type: "http",
        production_endpoints: {url: $backend},
        sandbox_endpoints: {url: $backend}
      },
      scopes: [
        {scope: {name: "apex:bank:accounts:read",              displayName: "Read accounts",     description: "List accounts"},        shared: false},
        {scope: {name: "apex:bank:accounts:balances:read",     displayName: "Read balances",     description: "Read balances"},        shared: false},
        {scope: {name: "apex:bank:accounts:transactions:read", displayName: "Read transactions", description: "Read transactions"},    shared: false},
        {scope: {name: "apex:bank:payees:read",                displayName: "Read payees",       description: "List saved payees"},    shared: false},
        {scope: {name: "apex:bank:payments:write",             displayName: "Initiate payments", description: "Initiate a payment"},   shared: false}
      ],
      operations: [
        {target: "/accounts",                     verb: "GET",  authType: "Application & Application User", throttlingPolicy: "Unlimited", scopes: ["apex:bank:accounts:read","apex:bank:accounts:balances:read"]},
        {target: "/transactions",                 verb: "GET",  authType: "Application & Application User", throttlingPolicy: "Unlimited", scopes: ["apex:bank:accounts:transactions:read"]},
        {target: "/payees",                       verb: "GET",  authType: "Application & Application User", throttlingPolicy: "Unlimited", scopes: ["apex:bank:payees:read"]},
        {target: "/products",                     verb: "GET",  authType: "Application & Application User", throttlingPolicy: "Unlimited", scopes: []},
        {target: "/accounts/{accountId}/payments", verb: "POST", authType: "Application & Application User", throttlingPolicy: "Unlimited", scopes: ["apex:bank:payments:write"]}
      ]
    }')"
  created="$(api -X POST "${auth[@]}" -H 'Content-Type: application/json' \
    --data-binary "$payload" "${PUB}/apis")"
  API_ID="$(jq -r '.id // empty' <<<"$created")"
  [ -n "$API_ID" ] || die "could not create the API: $(jq -c '{code,message,description}' <<<"$created" 2>/dev/null || head -c 300 <<<"$created")"
fi

# ---------------------------------------------------------------- revision
# Publishing sets the lifecycle state; it does NOT put the API on a gateway.
# Without a deployed revision every request answers 404 from the gateway, which
# looks like the context is wrong rather than the API being undeployed.
revision="$(api "${auth[@]}" "${PUB}/apis/${API_ID}/revisions?query=deployed:true" |
            jq -r '.list[0].id // empty')"
if [ -n "$revision" ]; then
  say "a deployed revision already exists (${revision})"
else
  say "creating and deploying a revision"
  revision="$(api -X POST "${auth[@]}" -H 'Content-Type: application/json' \
    -d '{"description":"provisioned by init/apim-init.sh"}' \
    "${PUB}/apis/${API_ID}/revisions" | jq -r '.id // empty')"
  [ -n "$revision" ] || die "could not create a revision"

  # The gateway environment lives on the ADMIN API; the publisher's own
  # /environments is empty, and deploying to an empty name succeeds while
  # putting the API on no gateway at all -- every request then 404s.
  gw="$(api "${auth[@]}" "${APIM_BASE_URL}/api/am/admin/v4/environments")"
  gw_env="$(jq -r '.list[0].name // empty' <<<"$gw")"
  gw_vhost="$(jq -r '.list[0].vhosts[0].host // "localhost"' <<<"$gw")"
  [ -n "$gw_env" ] || die "no gateway environment found on APIM"
  api -X POST "${auth[@]}" -H 'Content-Type: application/json' \
    -d "[{\"name\":\"${gw_env}\",\"vhost\":\"${gw_vhost}\",\"displayOnDevportal\":true}]" \
    "${PUB}/apis/${API_ID}/deploy-revision?revisionId=${revision}" >/dev/null ||
    die "could not deploy revision ${revision} to ${gw_env}"
  say "  deployed revision ${revision} to ${gw_env}"
fi

# ----------------------------------------------------------------- publish
state="$(api "${auth[@]}" "${PUB}/apis/${API_ID}" | jq -r '.lifeCycleStatus // empty')"
if [ "$state" = "PUBLISHED" ]; then
  say "already PUBLISHED"
else
  say "publishing (was ${state:-unknown})"
  api -X POST "${auth[@]}" \
    "${PUB}/apis/change-lifecycle?apiId=${API_ID}&action=Publish" >/dev/null ||
    die "could not publish the API"
  say "  published"
fi


# ----------------------------------------------------------- key manager
# APIM must trust tokens ThunderID issued. CustomKeyManager is the
# out-of-band connector: our OAuth clients are created by thunder-init, not by
# APIM, so app creation and token generation stay off.
#
# consumerKeyClaim is the setting that matters and defaults to `azp`.
# ThunderID puts the client in `client_id`, so with the default APIM cannot
# resolve which application a token belongs to and answers 403 on EVERY
# resource -- including ones with no scope requirement, which makes it look
# like a subscription problem rather than a claim-mapping one.
KM_NAME="${APIM_KEY_MANAGER_NAME:-ThunderID}"
km_id="$(api "${auth[@]}" "${APIM_BASE_URL}/api/am/admin/v4/key-managers" |
         jq -r --arg n "$KM_NAME" '.list[]? | select(.name == $n) | .id // empty' | head -1)"

km_payload="$(jq -n --arg name "$KM_NAME" --arg base "$THUNDER_BASE_URL" \
  '{name: $name, displayName: $name, type: "CustomKeyManager",
    description: "Apex banking identity provider", enabled: true,
    issuer: $base,
    wellKnownEndpoint: ($base + "/.well-known/openid-configuration"),
    introspectionEndpoint: ($base + "/oauth2/introspect"),
    tokenEndpoint: ($base + "/oauth2/token"),
    revokeEndpoint: ($base + "/oauth2/revoke"),
    authorizeEndpoint: ($base + "/oauth2/authorize"),
    certificates: {type: "JWKS", value: ($base + "/oauth2/jwks")},
    availableGrantTypes: ["client_credentials","authorization_code","refresh_token","urn:ietf:params:oauth:grant-type:token-exchange"],
    consumerKeyClaim: "client_id", scopesClaim: "scope",
    enableSelfValidationJWT: true, enableMapOAuthConsumerApps: true,
    enableTokenGeneration: false, enableOAuthAppCreation: false}')"

if [ -n "$km_id" ]; then
  say "key manager ${KM_NAME} exists (${km_id}); reasserting its configuration"
  api -X PUT "${auth[@]}" -H 'Content-Type: application/json' \
    --data-binary "$km_payload" "${APIM_BASE_URL}/api/am/admin/v4/key-managers/${km_id}" >/dev/null ||
    die "could not update key manager ${KM_NAME}"
else
  say "registering key manager ${KM_NAME}"
  km_id="$(api -X POST "${auth[@]}" -H 'Content-Type: application/json' \
    --data-binary "$km_payload" "${APIM_BASE_URL}/api/am/admin/v4/key-managers" | jq -r '.id // empty')"
  [ -n "$km_id" ] || die "could not register key manager ${KM_NAME}"
fi

DEV="${APIM_BASE_URL}/api/am/devportal/v3"

# One APIM application PER ThunderID client. An application accepts only ONE
# PRODUCTION key per key manager, so mapping a second client onto the same
# application is silently rejected -- the map-keys call returns 200 and nothing
# is stored, and the second client then 403s on every request.
map_client() { # APP_NAME CONSUMER_KEY
  local app_name="$1" consumer="$2" aid sub mapped
  aid="$(api "${auth[@]}" "${DEV}/applications?query=${app_name}" |
         jq -r --arg n "$app_name" '.list[]? | select(.name == $n) | .applicationId // empty' | head -1)"
  if [ -z "$aid" ]; then
    say "  creating application ${app_name}"
    aid="$(api -X POST "${auth[@]}" -H 'Content-Type: application/json' \
      -d "{\"name\":\"${app_name}\",\"throttlingPolicy\":\"Unlimited\",\"tokenType\":\"JWT\",\"description\":\"${consumer}\"}" \
      "${DEV}/applications" | jq -r '.applicationId // empty')"
    [ -n "$aid" ] || die "could not create application ${app_name}"
  fi

  sub="$(api "${auth[@]}" "${DEV}/subscriptions?applicationId=${aid}" |
         jq -r --arg a "$API_ID" '[.list[]? | select(.apiId == $a)] | length')"
  if [ "${sub:-0}" -eq 0 ]; then
    api -X POST "${auth[@]}" -H 'Content-Type: application/json' \
      -d "{\"applicationId\":\"${aid}\",\"apiId\":\"${API_ID}\",\"throttlingPolicy\":\"Unlimited\"}" \
      "${DEV}/subscriptions" >/dev/null || die "could not subscribe ${app_name}"
  fi

  mapped="$(api "${auth[@]}" "${DEV}/applications/${aid}/oauth-keys" |
            jq -r --arg c "$consumer" '[.list[]? | select(.consumerKey == $c)] | length')"
  if [ "${mapped:-0}" -gt 0 ]; then
    say "  ${consumer} already mapped to ${app_name}"
  else
    api -X POST "${auth[@]}" -H 'Content-Type: application/json' \
      -d "{\"consumerKey\":\"${consumer}\",\"keyManager\":\"${KM_NAME}\",\"keyType\":\"PRODUCTION\"}" \
      "${DEV}/applications/${aid}/map-keys" >/dev/null || true
    # map-keys answers 200 even when it stores nothing, so confirm by reading back.
    mapped="$(api "${auth[@]}" "${DEV}/applications/${aid}/oauth-keys" |
              jq -r --arg c "$consumer" '[.list[]? | select(.consumerKey == $c)] | length')"
    [ "${mapped:-0}" -gt 0 ] || die "could not map ${consumer} to ${app_name}"
    say "  mapped ${consumer} to ${app_name}"
  fi
}

say "mapping ThunderID clients to APIM applications"
map_client "${APIM_APP_NAME:-ApexBankingSystem}" apex-mcp-client
map_client "ApexPortal" apex-portal-client

# ------------------------------------------------------------------ output
GATEWAY_URL="${APIM_GATEWAY_URL:-https://apim:8243}${API_CONTEXT}/${API_VERSION}"

tmp="${OUT}.apim.tmp"
cat > "$tmp" <<EOF
# Generated by init/apim-init.sh -- do not edit, do not commit.
APIM_BANK_API_ID=${API_ID}
APIM_BANK_API_URL=${GATEWAY_URL}
# What the MCP server calls. The gateway, never the backend directly: it is the
# only place the bank token's scope is actually enforced, so a tool that talks
# to the backend is a tool whose narrowing nobody checks.
MCP_OUTBOUND_API__BASE_URL=${GATEWAY_URL}
# APIM_COMPLETE
EOF
if [ -f "$OUT" ]; then
  grep -v '^APIM_BANK_API\|^MCP_OUTBOUND_API__BASE_URL\|^# Generated by init/apim-init\|^# APIM_COMPLETE' "$OUT" >> "$tmp" || true
fi
mv "$tmp" "$OUT"

cat <<EOF

================ Apex — APIM ready ================
  API         ${API_NAME} ${API_VERSION} (${API_ID})
  Context     ${API_CONTEXT}/${API_VERSION}
  Backend     ${BACKEND_URL}
  Gateway     ${GATEWAY_URL}
===================================================
EOF
