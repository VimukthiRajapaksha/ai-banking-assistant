#!/usr/bin/env bash
# Mints an AMP API token for the provisioning client.
#
# AMP validates tokens against ThunderID's own issuer, and its resource
# identifier is urn:wso2:amp -- a different resource from the ThunderID
# management API, so this is a separate token from thunder-token.sh even though
# both come from the same client.
set -euo pipefail

: "${THUNDER_BASE_URL:?set THUNDER_BASE_URL}"
: "${THUNDER_CLIENT_ID:?set THUNDER_CLIENT_ID}"
: "${THUNDER_CLIENT_SECRET:?set THUNDER_CLIENT_SECRET}"

# amp:evaluator:read / amp:monitor:* provision the agent's evaluation monitor.
#
# amp:agent:update is required to READ an agent's identities -- the audit log
# names it (requiredPermission: amp:agent:update) where the endpoint's own
# naming suggests an agent-identity scope would do. It will not.
SCOPES="${AMP_SCOPES:-amp:org:view amp:org:modify-settings amp:project:create amp:project:read \
amp:environment:create amp:environment:read amp:agent:create amp:agent:read amp:agent:update amp:agent:delete amp:agent:token-manage \
amp:agent-identity:create amp:agent-identity:read amp:agent-identity:update amp:agent:api-key-manage amp:llm-provider:create amp:llm-provider:read amp:llm-provider:update amp:llm-provider:delete amp:llm-provider:connect \
amp:llm-provider:deploy amp:llm-provider:api-key-manage amp:llm-provider:configure-guardrail \
amp:llm-provider-template:read amp:llm-proxy:create amp:llm-proxy:read amp:llm-proxy:api-key-manage \
amp:gateway:read \
amp:evaluator:read amp:monitor:create amp:monitor:read amp:monitor:update}"

response="$(curl -sf -u "${THUNDER_CLIENT_ID}:${THUNDER_CLIENT_SECRET}" \
  -d 'grant_type=client_credentials' \
  --data-urlencode "scope=${SCOPES}" \
  --data-urlencode 'resource=urn:wso2:amp' \
  "${THUNDER_BASE_URL}/oauth2/token")" ||
  { echo "!! AMP token request failed" >&2; exit 1; }

token="$(jq -r '.access_token // empty' <<<"$response")"
[ -n "$token" ] || { echo "!! no access_token in response" >&2; exit 1; }

# Without ouId/ouHandle in the token AMP answers 401/403 regardless of scopes;
# the client must opt in via its access-token attributes.
payload="$(cut -d. -f2 <<<"$token" | tr '_-' '/+' | base64 -d 2>/dev/null || true)"
grep -q 'ouId' <<<"$payload" || {
  echo "!! token carries no ouId claim -- add ouId/ouHandle to ${THUNDER_CLIENT_ID}'s access-token attributes" >&2
  exit 1
}

printf '%s' "$token"
