#!/usr/bin/env bash
# Provisions ThunderID for the Apex banking system: resource servers, flows,
# applications, the customer, and roles. Writes generated credentials to
# .env.generated.
#
# Idempotent by fixed ids: a re-run adopts what exists rather than duplicating,
# and NEVER regenerates a secret already recorded -- rotating one would
# invalidate whatever is already running, surfacing as confusing 401s from the
# token endpoint rather than anything pointing here.
#
# One prerequisite cannot be automated: the provisioning application itself.
# An application cannot grant itself the role it needs, and ThunderID closes
# every self-service route -- DCR is permission-gated, there is no password
# grant, and unauthenticated writes are refused. See README Step 0.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE="${HERE}/thunder"
OUT="${OUT_FILE:-${HERE}/../.env.generated}"

: "${THUNDER_BASE_URL:?set THUNDER_BASE_URL in .env}"
: "${THUNDER_CLIENT_ID:?set THUNDER_CLIENT_ID in .env -- see README Step 0}"
: "${THUNDER_CLIENT_SECRET:?set THUNDER_CLIENT_SECRET in .env -- see README Step 0}"

PORTAL_ORIGIN="${APEX_PORTAL_ORIGIN:-http://portal.apex.localhost}"
CUSTOMER_PASSWORD="${APEX_USER_PASSWORD:-ApexBank@123}"

say() { printf '==> %s\n' "$*"; }
die() { printf '!! %s\n' "$*" >&2; exit 1; }

say "requesting a management token"
TOKEN="$("${HERE}/thunder-token.sh")" || die "could not obtain a ThunderID token"
auth=(-H "Authorization: Bearer ${TOKEN}")

# ---------------------------------------------------------------- secrets
# Read back from a previous run before generating: see the header.
# Takes the key the value is STORED under in .env.generated, which is not the
# same as the shell variable holding it: the secret for APEX_AGENT_CLIENT_SECRET
# is written as AGENT_IDENTITY__CLIENT_SECRET, because that is what the agent
# reads. Grepping for the shell name found nothing and silently minted a new
# secret on every run -- rotating credentials the services were already using,
# and drifting from what ThunderID had stored.
keep_or_make() { # STORED_KEY -> prints the existing value, or a new one
  local key="$1" existing=""
  [ -f "$OUT" ] && existing="$(grep -m1 "^${key}=" "$OUT" | cut -d= -f2- || true)"
  if [ -n "$existing" ]; then printf '%s' "$existing"
  else openssl rand -base64 32 | tr -d '/+=' | cut -c1-43; fi
}

APEX_SECURITY_FLOW_SECRET="$(keep_or_make APEX_SECURITY_FLOW_SECRET)"
APEX_MCP_FLOW_SECRET="$(keep_or_make APEX_MCP_FLOW_SECRET)"
APEX_AGENT_CLIENT_SECRET="$(keep_or_make AGENT_IDENTITY__CLIENT_SECRET)"
APEX_MCP_CLIENT_SECRET="$(keep_or_make MCP_OUTBOUND_OAUTH__CLIENT_SECRET)"
APEX_CONSENT_PORTAL_CLIENT_SECRET="$(keep_or_make BFF_AUTH__CLIENT_SECRET)"
APEX_AGENT_IDENTITY_SECRET="$(keep_or_make AGENT_IDENTITY__AGENT_SECRET)"

# ----------------------------------------------------------------- import
# Variables are Go-template `{{.NAME}}`. The bare `{{NAME}}` form substitutes
# NOTHING and reports success, which once set a customer's password to the
# literal string "{{APEX_USER_PASSWORD}}".
import_file() { # FILE
  local file="$1" payload response failed
  payload="$(jq -n \
    --rawfile content "$file" \
    --arg sec_flow "$APEX_SECURITY_FLOW_SECRET" \
    --arg mcp_flow "$APEX_MCP_FLOW_SECRET" \
    --arg agent_secret "$APEX_AGENT_CLIENT_SECRET" \
    --arg mcp_secret "$APEX_MCP_CLIENT_SECRET" \
    --arg portal_secret "$APEX_CONSENT_PORTAL_CLIENT_SECRET" \
    --arg agent_identity_secret "$APEX_AGENT_IDENTITY_SECRET" \
    --arg user_password "$CUSTOMER_PASSWORD" \
    '{content: $content, dryRun: false,
      options: {upsert: true, continueOnError: true},
      variables: {
        APEX_SECURITY_FLOW_SECRET: $sec_flow,
        APEX_MCP_FLOW_SECRET: $mcp_flow,
        APEX_AGENT_CLIENT_SECRET: $agent_secret,
        APEX_MCP_CLIENT_SECRET: $mcp_secret,
        APEX_CONSENT_PORTAL_CLIENT_SECRET: $portal_secret,
        APEX_AGENT_IDENTITY_SECRET: $agent_identity_secret,
        APEX_USER_PASSWORD: $user_password}}')"

  response="$(curl -s -X POST "${auth[@]}" -H 'Content-Type: application/json' \
    --data-binary "$payload" "${THUNDER_BASE_URL}/import")"

  # continueOnError means the call succeeds while individual documents fail;
  # the summary is the only place that says so.
  jq -r '.results[]? | "    \(.resourceId // .resourceName) \(.operation) \(.status) \(.code // "") \(.message // "")"' <<<"$response"

  # USR-1028 on an UPDATE is the idempotent path, not an error: ThunderID
  # refuses to change an existing user's password through import, which is
  # precisely the behaviour we want on a re-run. Treated as benign only when
  # the operation was an update -- on a create it is a real failure.
  real_failures="$(jq '[.results[]? | select(.status == "failed")
                        | select((.operation == "update" and .code == "USR-1028") | not)]
                       | length' <<<"$response")"
  [ "$real_failures" = "0" ] ||
    die "import of $(basename "$file") had ${real_failures} failure(s)"
}

for file in "${BUNDLE}"/*.yaml; do
  say "importing $(basename "$file")"
  import_file "$file"
done

# ------------------------------------------------- post-import corrections
# passkeyAllowedOrigins is accepted by the importer and silently discarded, so
# it has to be PUT afterwards -- and re-applied after EVERY import, because a
# re-import wipes it. A passkey ceremony whose origin is not listed fails at
# the very last step with a generic registration error.
set_passkey_origins() { # APP_ID
  local app_id="$1" current updated
  current="$(curl -sf "${auth[@]}" "${THUNDER_BASE_URL}/applications/${app_id}")" ||
    die "could not read application ${app_id}"
  updated="$(jq --arg o "$PORTAL_ORIGIN" '.passkeyAllowedOrigins = [$o]' <<<"$current")"
  curl -sf -X PUT "${auth[@]}" -H 'Content-Type: application/json' \
    --data-binary "$updated" "${THUNDER_BASE_URL}/applications/${app_id}" >/dev/null ||
    die "could not set passkeyAllowedOrigins on ${app_id}"
  say "passkey origins set on ${app_id}"
}

set_passkey_origins apex-security-client
set_passkey_origins apex-mcp-client

# CORS is server-wide and shared with whatever else uses this ThunderID, so
# this appends rather than replaces.
say "ensuring ${PORTAL_ORIGIN} is an allowed CORS origin"
cors="$(curl -sf "${auth[@]}" "${THUNDER_BASE_URL}/server-config/cors")" || die "could not read CORS config"
if jq -e --arg o "$PORTAL_ORIGIN" '.merged.allowedOrigins | index($o)' >/dev/null <<<"$cors"; then
  say "  already present"
else
  body="$(jq --arg o "$PORTAL_ORIGIN" '{allowedOrigins: (.writable.allowedOrigins + [$o])}' <<<"$cors")"
  curl -sf -X PUT "${auth[@]}" -H 'Content-Type: application/json' \
    --data-binary "$body" "${THUNDER_BASE_URL}/server-config/cors" >/dev/null ||
    die "could not update CORS config"
  say "  added"
fi

# ------------------------------------------------------------------ output
tmp="${OUT}.thunder.tmp"
cat > "$tmp" <<EOF
# Generated by init/thunder-init.sh -- do not edit, do not commit.
THUNDER_ISSUER=${THUNDER_BASE_URL}
THUNDER_JWKS_URL=${THUNDER_BASE_URL}/oauth2/jwks

VITE_AUTH__CLIENT_ID=apex-portal-client
AGENT_IDENTITY__CLIENT_ID=apex-agent-client
AGENT_IDENTITY__CLIENT_SECRET=${APEX_AGENT_CLIENT_SECRET}
# The agent's own principal -- what becomes act.sub on a delegated token.
AGENT_IDENTITY__AGENT_ID=apex-banking-agent
AGENT_IDENTITY__AGENT_SECRET=${APEX_AGENT_IDENTITY_SECRET}
MCP_OUTBOUND_OAUTH__CLIENT_ID=apex-mcp-client
MCP_OUTBOUND_OAUTH__CLIENT_SECRET=${APEX_MCP_CLIENT_SECRET}
BFF_AUTH__CLIENT_ID=apex-consent-portal-client
BFF_AUTH__CLIENT_SECRET=${APEX_CONSENT_PORTAL_CLIENT_SECRET}

# Flow Secrets are presented as the \`Flow-Secret\` header when a SERVER starts
# an app-native flow. They must never be bundled into browser JavaScript.
APEX_SECURITY_FLOW_SECRET=${APEX_SECURITY_FLOW_SECRET}
APEX_MCP_FLOW_SECRET=${APEX_MCP_FLOW_SECRET}
# The same secret, under the name the MCP server reads it by. Written here
# rather than duplicated into a service .env so there is one place it is set.
MCP_STEPUP__FLOW_SECRET=${APEX_MCP_FLOW_SECRET}
# The enrolment flow's secret, under the name the agent reads it by. The agent
# relays passkey enrolment for the portal, because this secret must never be
# shipped to a browser.
AGENT_SECURITY__FLOW_SECRET=${APEX_SECURITY_FLOW_SECRET}

# The one audience. ThunderID filters a token's scopes to the resource server
# named by \`resource\`, and a token may name exactly one -- so four audiences
# meant four disjoint scope sets that no delegated exchange could carry between.
# One resource server, and the permission namespace separates the services.
APEX_AUDIENCE=urn:apex
# THUNDER_COMPLETE
EOF

if [ -f "$OUT" ]; then
  grep -v '^THUNDER_\|^VITE_AUTH__CLIENT_ID\|^AGENT_IDENTITY__\|^MCP_OUTBOUND_OAUTH__CLIENT\|^BFF_AUTH__CLIENT\|^APEX_SECURITY_FLOW_SECRET\|^APEX_MCP_FLOW_SECRET\|^MCP_STEPUP__FLOW_SECRET\|^AGENT_SECURITY__FLOW_SECRET\|^APEX_AUDIENCE=\|^# Generated by init/thunder-init\|^# THUNDER_COMPLETE\|^# Flow Secrets\|^# an app-native flow\|^# The one audience\|^# named by\|^# meant four\|^# One resource server' \
    "$OUT" >> "$tmp" || true
fi
mv "$tmp" "$OUT"

cat <<EOF

================ Apex — ThunderID ready ================
  Instance    ${THUNDER_BASE_URL}
  Customer    alex@apexbank.com / ${CUSTOMER_PASSWORD}
  Portal      ${PORTAL_ORIGIN}
  Credentials ${OUT}
========================================================
EOF
