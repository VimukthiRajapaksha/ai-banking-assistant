#!/usr/bin/env bash
# Provisions the Agent Management Platform for the Apex banking system: a
# project, an Anthropic LLM provider fronted by the gateway, the agent itself,
# and the credentials the running services need.
#
# The Anthropic key is an INPUT here and never an output: it is configured on
# the provider, and what the agent receives instead is a gateway-issued key for
# a proxy URL. The real credential stays on the platform.
#
# Organizations and environments are GET-only in the AMP API -- they are
# provisioned with the platform, not by clients -- so this adopts the existing
# ones rather than creating them.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${OUT_FILE:-${HERE}/../.env.generated}"

: "${AMP_BASE_URL:?set AMP_BASE_URL in .env}"
: "${ANTHROPIC_API_KEY:?set ANTHROPIC_API_KEY in .env}"

ORG="${AMP_ORG:-default}"
PROJECT="${AMP_PROJECT:-apex}"
# Matches the ThunderID agent identity name, so the platform's view of the
# agent and the principal that actually acts carry the same name.
AGENT_NAME="${AMP_AGENT_NAME:-apex-banking-agent}"
PROVIDER_ID="${AMP_LLM_PROVIDER_ID:-apex-anthropic}"
ENVIRONMENT="${AMP_ENVIRONMENT:-default}"

say() { printf '==> %s\n' "$*"; }
die() { printf '!! %s\n' "$*" >&2; exit 1; }

say "requesting an AMP token"
TOKEN="$("${HERE}/amp-token.sh")" || die "could not obtain an AMP token"
auth=(-H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json')
API="${AMP_BASE_URL}/api/v1/orgs/${ORG}"

# GET a resource, returning empty when absent, so every step is
# lookup-before-create and a re-run adopts rather than duplicates.
get_or_empty() { curl -s "${auth[@]}" "$1" 2>/dev/null || true; }

# ------------------------------------------------------------------ project
if curl -sf "${auth[@]}" "${API}/projects/${PROJECT}" >/dev/null 2>&1; then
  say "project ${PROJECT} exists"
else
  say "creating project ${PROJECT}"
  # deploymentPipeline is required ("Missing deployment pipeline in request
  # body"). Like the org and environment, the pipeline is provisioned with the
  # platform, so the existing "default" is adopted.
  curl -sf -X POST "${auth[@]}" "${API}/projects" -d "$(jq -n \
    --arg name "$PROJECT" --arg pipeline "${AMP_DEPLOYMENT_PIPELINE:-default}" \
    '{name: $name, displayName: "Apex", description: "Apex banking system", deploymentPipeline: $pipeline}')" \
    >/dev/null || die "could not create project ${PROJECT}"
fi

# ------------------------------------------------------------- llm provider
# `context` becomes the path the gateway serves the proxy on, and `security`
# makes the gateway demand its own key -- which is what lets the real Anthropic
# credential stay here rather than travelling to the agent.
if curl -sf "${auth[@]}" "${API}/llm-providers/${PROVIDER_ID}" >/dev/null 2>&1; then
  say "llm provider ${PROVIDER_ID} exists"
else
  say "creating llm provider ${PROVIDER_ID}"
  curl -sf -X POST "${auth[@]}" "${API}/llm-providers" -d "$(jq -n \
    --arg id "$PROVIDER_ID" --arg key "$ANTHROPIC_API_KEY" \
    '{id: $id, name: $id, description: "Anthropic, fronted by the gateway",
      version: "v1.0", context: ("/" + $id), template: "anthropic",
      upstream: {main: {url: "https://api.anthropic.com",
                        auth: {type: "api-key", header: "x-api-key", value: $key}}},
      security: {enabled: true, apiKey: {enabled: true, in: "header", key: "X-API-Key"}},
      accessControl: {mode: "allow_all"}}')" \
    >/dev/null || die "could not create llm provider ${PROVIDER_ID}"
fi

# The API is inconsistent about which key identifies a provider: GET accepts
# the slug, while PUT, deployments and api-keys demand the uuid and answer
# "invalid UUID length" otherwise. Resolve it once and use it for writes.
PROVIDER_UUID="$(get_or_empty "${API}/llm-providers/${PROVIDER_ID}" | jq -r '.uuid // empty')"
[ -n "$PROVIDER_UUID" ] || die "could not resolve the uuid of llm provider ${PROVIDER_ID}"

# accessControl is what makes the gateway publish the route. Without it the
# deployment reports success, the console shows "Deployed", and every request
# to the proxy answers 404 -- so it is asserted on every run, not just create.
say "ensuring access control on ${PROVIDER_ID}"
provider="$(get_or_empty "${API}/llm-providers/${PROVIDER_ID}")"
if [ "$(jq -r '.accessControl.mode // empty' <<<"$provider")" = "allow_all" ]; then
  say "  already set"
else
  curl -sf -X PUT "${auth[@]}" "${API}/llm-providers/${PROVIDER_UUID}" \
    -d "$(jq '.accessControl = {mode: "allow_all"}' <<<"$provider")" >/dev/null ||
    die "could not set accessControl on ${PROVIDER_ID}"
  say "  set"
fi

# The upstream key is set on create, so a key rotated in .env would otherwise
# never reach the provider. AMP returns it redacted, so change is detected from a
# hash recorded in the output file -- never the key itself.
key_sha="$(printf '%s' "$ANTHROPIC_API_KEY" | { sha256sum 2>/dev/null || shasum -a 256; } | cut -c1-16)"
recorded_sha=""
[ -f "$OUT" ] && recorded_sha="$(grep -m1 '^AMP_UPSTREAM_KEY_SHA=' "$OUT" | cut -d= -f2- || true)"
if [ "$key_sha" = "$recorded_sha" ]; then
  say "upstream key unchanged"
else
  say "setting the upstream key on ${PROVIDER_ID}"
  provider="$(get_or_empty "${API}/llm-providers/${PROVIDER_ID}")"
  curl -sf -X PUT "${auth[@]}" "${API}/llm-providers/${PROVIDER_UUID}" \
    -d "$(jq --arg key "$ANTHROPIC_API_KEY" '.upstream.main.auth.value = $key' <<<"$provider")" >/dev/null ||
    die "could not set the upstream key on ${PROVIDER_ID}"
fi

# ------------------------------------------------------------- deploy to gw
# The gateway's identifier is `uuid`, not `id`, and `vhost` carries the public
# base URL -- taken from the platform rather than assembled from the org and
# environment names, which only happen to match today.
gateways="$(get_or_empty "${API}/gateways")"
GATEWAY_ID="$(jq -r '.gateways[0].uuid // empty' <<<"$gateways")"
GATEWAY_VHOST="$(jq -r '.gateways[0].vhost // empty' <<<"$gateways")"
[ -n "$GATEWAY_ID" ] || die "no gateway found in org ${ORG}"
[ -n "$GATEWAY_VHOST" ] || die "gateway ${GATEWAY_ID} exposes no vhost"

deployed="$(get_or_empty "${API}/llm-providers/${PROVIDER_UUID}/deployments" |
            jq -r '[(if type == "array" then .[] else .deployments[]? end)
                    | select(.status == "DEPLOYED")] | length')"
if [ "${deployed:-0}" -gt 0 ]; then
  say "llm provider already deployed"
else
  say "deploying llm provider to gateway ${GATEWAY_ID}"
  # `base` is required and undocumented in the error: "current" deploys the
  # provider as it stands now.
  curl -sf -X POST "${auth[@]}" "${API}/llm-providers/${PROVIDER_UUID}/deployments" \
    -d "{\"name\":\"${PROVIDER_ID}\",\"gatewayId\":\"${GATEWAY_ID}\",\"base\":\"current\"}" >/dev/null ||
    die "could not deploy ${PROVIDER_ID} to gateway ${GATEWAY_ID}"
fi

# -------------------------------------------------------------------- agent
# provisioning.type=external: the agent runs in our own stack, so AMP registers
# and observes it rather than building and hosting it.
if curl -sf "${auth[@]}" "${API}/projects/${PROJECT}/agents/${AGENT_NAME}" >/dev/null 2>&1; then
  say "agent ${AGENT_NAME} exists"
else
  say "creating agent ${AGENT_NAME}"
  curl -sf -X POST "${auth[@]}" "${API}/projects/${PROJECT}/agents" -d "$(jq -n \
    --arg name "$AGENT_NAME" --arg provider "$PROVIDER_ID" \
    '{name: $name, displayName: "Apex Banking Assistant",
      description: "Conversational banking assistant",
      agentType: {type: "external-agent-api"},
      provisioning: {type: "external"},
      modelConfig: [{providerName: $provider}]}')" \
    >/dev/null || die "could not create agent ${AGENT_NAME}"
fi

# --------------------------------------------------------- agent llm proxy
# Registering the agent with modelConfig makes AMP create a model config and,
# per environment, a dedicated LLM proxy in front of the provider. The agent
# calls that proxy, not the provider: agent-level guardrails run there, on top
# of the provider's own. Its URL and auth header are read back from AMP rather
# than assumed -- the proxy context is generated, and its key header ("API-Key")
# is not the provider's ("X-API-Key").
CONFIG_ID=""; PROXY_URL=""; PROXY_UUID=""
for _ in $(seq 1 ${AMP_PROXY_WAIT:-12}); do
  CONFIG_ID="$(get_or_empty "${API}/projects/${PROJECT}/agents/${AGENT_NAME}/model-configs" |
               jq -r '[.configs[]? | select(.type == "llm")] | first | .uuid // empty')"
  if [ -n "$CONFIG_ID" ]; then
    model_config="$(get_or_empty "${API}/projects/${PROJECT}/agents/${AGENT_NAME}/model-configs/${CONFIG_ID}")"
    PROXY_URL="$(jq -r --arg env "$ENVIRONMENT" '.envMappings[$env].configuration.url // empty' <<<"$model_config")"
    PROXY_UUID="$(jq -r --arg env "$ENVIRONMENT" '.envMappings[$env].configuration.proxyUuid // empty' <<<"$model_config")"
    [ -n "$PROXY_URL" ] && [ -n "$PROXY_UUID" ] && break
  fi
  sleep 5
done
[ -n "$PROXY_URL" ] || die "agent ${AGENT_NAME} has no LLM proxy in environment ${ENVIRONMENT}"

proxy_security="$(get_or_empty "${API}/projects/${PROJECT}/llm-proxies" |
  jq -c --arg u "$PROXY_UUID" '.proxies[]? | select(.uuid == $u) | .configuration.security.apiKey // empty')"
[ "$(jq -r '.in // empty' <<<"$proxy_security")" = "header" ] ||
  die "LLM proxy ${PROXY_UUID} does not take its key in a header"
KEY_HEADER="$(jq -r '.key' <<<"$proxy_security")"
say "agent llm proxy ${PROXY_URL} (key header ${KEY_HEADER})"

# ------------------------------------------------------------ gateway key
# What the agent presents to its proxy. The real Anthropic credential stays on
# the provider; this key only opens the proxy route. AMP shows a key once, so a
# recorded key is reused -- unless it was issued for another URL (the provider,
# before the agent moved to its proxy), in which case a proxy key is minted.
KEY_NAME="${AGENT_NAME}-proxy-key"
KEYS_API="${API}/projects/${PROJECT}/agents/${AGENT_NAME}/model-configs/${CONFIG_ID}/environments/${ENVIRONMENT}/api-keys"
AGENT_LLM_KEY=""; recorded_url=""
if [ -f "$OUT" ]; then
  AGENT_LLM_KEY="$(grep -m1 '^AGENT_LLM__ANTHROPIC_API_KEY=' "$OUT" | cut -d= -f2- || true)"
  recorded_url="$(grep -m1 '^AGENT_LLM__BASE_URL=' "$OUT" | cut -d= -f2- || true)"
fi
if [ -n "$AGENT_LLM_KEY" ] && [ "$recorded_url" = "$PROXY_URL" ]; then
  say "proxy key already recorded; left unchanged"
else
  say "minting a key for the agent's llm proxy"
  mint() { curl -sf -X POST "${auth[@]}" "$KEYS_API" \
             -d "{\"name\":\"${KEY_NAME}\",\"displayName\":\"${KEY_NAME}\"}" | jq -r '.apiKey // empty'; }
  AGENT_LLM_KEY="$(mint || true)"
  if [ -z "$AGENT_LLM_KEY" ]; then
    # The name exists but its value is not on disk (lost .env.generated): AMP
    # never shows a key twice, so replace it.
    curl -sf -X DELETE "${auth[@]}" "${KEYS_API}/${KEY_NAME}" >/dev/null || true
    AGENT_LLM_KEY="$(mint || true)"
  fi
  [ -n "$AGENT_LLM_KEY" ] || die "could not mint a key for the agent's llm proxy"
fi

# The provider key earlier versions of this script handed the agent would open
# the provider route directly, around the agent's guardrails. Revoke it.
if get_or_empty "${API}/llm-providers/${PROVIDER_UUID}/api-keys" |
   jq -e --arg n "${AGENT_NAME}-llm-key" '.keys[]? | select(.name == $n)' >/dev/null; then
  say "revoking the old provider key ${AGENT_NAME}-llm-key"
  curl -sf -X DELETE "${auth[@]}" "${API}/llm-providers/${PROVIDER_UUID}/api-keys/${AGENT_NAME}-llm-key" >/dev/null ||
    say "  (could not revoke it; remove it from the provider's API keys in the console)"
fi

# ------------------------------------------------------- agent guardrails
# Guardrails are attached to the agent's model config -- the console's
# agent-level "Guardrails", written with the same PUT its "Add guardrail" button
# sends -- so they run on the agent's proxy. Each is reconciled on its own:
# present with the desired params, or absent when switched off. Anything else on
# the config (other guardrails, resilience, env var names) is kept.
MODEL_CONFIG_API="${API}/projects/${PROJECT}/agents/${AGENT_NAME}/model-configs/${CONFIG_ID}"

# catalog_version NAME TRIES -- the policy's version as the gateway reports it,
# empty when the gateway does not have it. The catalogue is a cache refilled by
# gateway heartbeats, so a freshly restarted AMP may need a moment.
catalog_version() {
  local v=""
  for _ in $(seq 1 "$2"); do
    v="$(get_or_empty "${API}/llm-providers/policies?providerId=${PROVIDER_UUID}" |
         jq -r --arg n "$1" '[.list[]? | select(.name == $n) | .version] | first // empty')"
    [ -n "$v" ] && break
    sleep 5
  done
  printf '%s' "$v"
}

# set_agent_policy NAME PARAMS_JSON [CATALOG_TRIES] -- an empty PARAMS_JSON removes it.
set_agent_policy() {
  local name="$1" params="$2" tries="${3:-1}" config current desired="" version
  config="$(get_or_empty "$MODEL_CONFIG_API")"
  current="$(jq -c --arg env "$ENVIRONMENT" --arg n "$name" \
    '[.envMappings[$env].configuration.policies // [] | .[] | select(.name == $n)] | first // empty' <<<"$config")"
  if [ -z "$params" ]; then
    [ -z "$current" ] && { say "${name}: off"; return; }
    desired="$(jq -c --arg env "$ENVIRONMENT" --arg n "$name" \
      '[.envMappings[$env].configuration.policies // [] | .[] | select(.name != $n)]' <<<"$config")"
  elif [ -n "$current" ] && [ "$(jq -cS '.paths[0].params' <<<"$current")" = "$(jq -cS . <<<"$params")" ]; then
    # Compared on params, not the whole entry: AMP may store a major-only version.
    say "${name}: already set"
    return
  else
    version="$(catalog_version "$name" "$tries")"
    if [ -z "$version" ]; then
      say "${name} is not on the gateway; not attached"
      return
    fi
    desired="$(jq -c --arg env "$ENVIRONMENT" --arg n "$name" --arg v "$version" --argjson params "$params" '
      [.envMappings[$env].configuration.policies // [] | .[] | select(.name != $n)]
      + [{name: $n, version: $v, paths: [{path: "/*", methods: ["*"], params: $params}]}]' <<<"$config")"
  fi
  say "${name}: $([ -n "$params" ] && echo setting || echo removing) on agent ${AGENT_NAME}"
  # The body the console sends: every environment mapping with its provider,
  # policies and resilience; the environment variable names kept as they are.
  curl -sf -X PUT "${auth[@]}" "$MODEL_CONFIG_API" -d "$(jq --arg env "$ENVIRONMENT" --argjson p "$desired" '
    {name,
     envMappings: (.envMappings | with_entries(.value = {
       providerName: .value.configuration.providerName,
       configuration: ({policies: (if .key == $env then $p else (.value.configuration.policies // []) end)}
                       + (if .value.configuration.resilience then {resilience: .value.configuration.resilience} else {} end))})),
     environmentVariables: [.environmentVariables[]? | {key, name}]}' <<<"$config")" >/dev/null ||
    die "could not update ${name} on agent ${AGENT_NAME}"
}

# NPI masking. npi-masking-regex is a custom gateway policy (gateway-policies/),
# so it exists only on a gateway built with it; on a stock gateway the catalogue
# lacks it and the step is skipped rather than failing the stack.
# AMP_NPI_GUARDRAIL: enforce (default) | monitor | off.
NPI_MODE="${AMP_NPI_GUARDRAIL:-enforce}"
if [ "$NPI_MODE" = "off" ]; then
  set_agent_policy npi-masking-regex ""
else
  set_agent_policy npi-masking-regex "$(jq -cn --arg mode "$NPI_MODE" '{mode: $mode, onError: "block"}')" \
    "${AMP_NPI_CATALOG_WAIT:-12}"
fi

# It must never stay on the provider as well: two instances would each mask and
# restore the same traffic. Earlier versions of this script put it there.
provider="$(get_or_empty "${API}/llm-providers/${PROVIDER_ID}")"
if jq -e '.policies // [] | any(.name == "npi-masking-regex")' <<<"$provider" >/dev/null; then
  say "removing the provider-level npi guardrail (now on the agent)"
  # `gateways` makes AMP update and redeploy in one call (UpdateAndSync).
  curl -sf -X PUT "${auth[@]}" "${API}/llm-providers/${PROVIDER_UUID}" \
    -d "$(jq --arg gw "$GATEWAY_ID" '.policies = [.policies[] | select(.name != "npi-masking-regex")] | .gateways = [$gw]' <<<"$provider")" >/dev/null ||
    die "could not remove the provider-level npi guardrail"
fi

# Token budget for the agent: total (prompt + completion) tokens per window.
# Measured Apex questions use 1.4k-6.3k tokens across 1-3 LLM calls, so the
# default allows ~10 heavy questions a minute. Exceeding it answers 429 until the
# window resets. AMP_TOKEN_LIMITS: "<count>/<duration>[,...]" | off.
TOKEN_LIMITS="${AMP_TOKEN_LIMITS:-60000/1m,1000000/1h}"
if [ "$TOKEN_LIMITS" = "off" ]; then
  set_agent_policy token-based-ratelimit ""
else
  limit_params="$(jq -cn --arg l "$TOKEN_LIMITS" '
    {totalTokenLimits: ($l | split(",") | map(split("/") |
      if length == 2 and (.[0] | test("^[0-9]+$")) and (.[1] | test("^[0-9]+(ms|s|m|h)$"))
      then {count: (.[0] | tonumber), duration: .[1]} else error("bad") end))}' 2>/dev/null)" ||
    die "AMP_TOKEN_LIMITS must look like 60000/1m,1000000/1h (got ${TOKEN_LIMITS})"
  set_agent_policy token-based-ratelimit "$limit_params"
fi

# ------------------------------------------------------ evaluation monitor
# A continuous AMP monitor scoring every traced Apex conversation with the
# rule-based evaluators (no LLM judge, so no judge credentials). The LLM-judge
# evaluators are left out: AMP's evaluation job currently fails them against an
# Anthropic judge. tool_coverage and sequence_adherence apply one expected tool
# set to every question, so non-account questions score low by design.
# AMP_QUALITY_MONITOR: on (default) | off; AMP_MONITOR_INTERVAL_MINUTES (>= 5).
MONITOR_NAME="${AGENT_NAME}-quality"
MONITOR_API="${API}/projects/${PROJECT}/agents/${AGENT_NAME}/monitors"
MONITOR_INTERVAL="${AMP_MONITOR_INTERVAL_MINUTES:-60}"
EVALUATORS='[
  {"identifier": "tool_coverage",        "displayName": "Tool coverage",        "config": {"required_tools": ["get_accounts"]}},
  {"identifier": "sequence_adherence",   "displayName": "Sequence adherence",   "config": {"expected_sequence": ["get_accounts", "get_transactions"], "strict": false}},
  {"identifier": "step_success_rate",    "displayName": "Step success rate",    "config": {"min_success_rate": 0.8}},
  {"identifier": "latency_performance",  "displayName": "Latency performance",  "config": {"max_latency_ms": 30000}},
  {"identifier": "token_efficiency",     "displayName": "Token efficiency",     "config": {"max_tokens": 10000}},
  {"identifier": "iteration_efficiency", "displayName": "Iteration efficiency", "config": {"max_iterations": 10}}
]'
monitor="$(curl -sf "${auth[@]}" "${MONITOR_API}/${MONITOR_NAME}" 2>/dev/null || true)"
if [ "${AMP_QUALITY_MONITOR:-on}" = "off" ]; then
  if [ -n "$monitor" ]; then
    say "stopping monitor ${MONITOR_NAME}"
    curl -sf -X POST "${auth[@]}" "${MONITOR_API}/${MONITOR_NAME}/stop" >/dev/null || true
  else
    say "monitor ${MONITOR_NAME}: off"
  fi
elif [ -z "$monitor" ]; then
  say "creating monitor ${MONITOR_NAME}"
  curl -sf -X POST "${auth[@]}" "$MONITOR_API" -d "$(jq -n --arg name "$MONITOR_NAME" \
    --arg env "$ENVIRONMENT" --argjson every "$MONITOR_INTERVAL" --argjson ev "$EVALUATORS" '
    {name: $name, displayName: "Apex quality", description: "Rule-based checks on every Apex conversation",
     environmentName: $env, type: "future", intervalMinutes: $every, samplingRate: 1, evaluators: $ev}')" \
    >/dev/null || die "could not create monitor ${MONITOR_NAME}"
# AMP adds defaulted keys to each evaluator's config, so it is compared as
# "contains what we asked for" rather than for equality.
elif jq -e --argjson ev "$EVALUATORS" --argjson every "$MONITOR_INTERVAL" '
       .intervalMinutes == $every and (.evaluators | length) == ($ev | length) and
       ([.evaluators[] | {identifier, config}] | contains([$ev[] | {identifier, config}]))' <<<"$monitor" >/dev/null; then
  say "monitor ${MONITOR_NAME} up to date"
else
  say "updating monitor ${MONITOR_NAME}"
  curl -sf -X PATCH "${auth[@]}" "${MONITOR_API}/${MONITOR_NAME}" -d "$(jq -n \
    --argjson every "$MONITOR_INTERVAL" --argjson ev "$EVALUATORS" '{intervalMinutes: $every, evaluators: $ev}')" \
    >/dev/null || die "could not update monitor ${MONITOR_NAME}"
fi

# --------------------------------------------------------- tracing token
# Regenerating would invalidate whatever is already publishing telemetry, so
# this only mints one when the file does not already carry it.
AMP_AGENT_API_KEY=""
[ -f "$OUT" ] && AMP_AGENT_API_KEY="$(grep -m1 '^AMP_AGENT_API_KEY=' "$OUT" | cut -d= -f2- || true)"
if [ -n "$AMP_AGENT_API_KEY" ]; then
  say "tracing token already recorded; left unchanged"
else
  say "minting a tracing token"
  # `environment` is a QUERY parameter here, not a body field -- sending it in
  # the body answers 500 "environment name cannot be empty", which reads like
  # the value was missing rather than misplaced. The body carries the lifetime.
  AMP_AGENT_API_KEY="$(curl -sf -X POST "${auth[@]}" \
    "${API}/projects/${PROJECT}/agents/${AGENT_NAME}/token?environment=${ENVIRONMENT}" \
    -d "{\"expires_in\":\"${AMP_TOKEN_TTL:-2160h}\"}" |
    jq -r '.token // empty')" || true
  [ -n "$AMP_AGENT_API_KEY" ] ||
    say "  (token endpoint returned no token; keeping whatever the services already use)"
fi

# ------------------------------------------------------------------ output
GATEWAY_BASE="${AMP_GATEWAY_BASE:-${GATEWAY_VHOST}}"

tmp="${OUT}.amp.tmp"
cat > "$tmp" <<EOF
# Generated by init/amp-init.sh -- do not edit, do not commit.
AMP_ORG=${ORG}
AMP_PROJECT=${PROJECT}
AMP_AGENT_NAME=${AGENT_NAME}
AMP_OTEL_ENDPOINT=${GATEWAY_BASE}/otel
AMP_AGENT_API_KEY=${AMP_AGENT_API_KEY}
# Hash of the Anthropic key last set on the provider (never the key itself).
AMP_UPSTREAM_KEY_SHA=${key_sha}

# The agent talks to its AMP LLM proxy, not to Anthropic. The key below is issued
# for that proxy; the real Anthropic credential stays on the LLM provider.
AGENT_LLM__BASE_URL=${PROXY_URL}
AGENT_LLM__ANTHROPIC_API_KEY=${AGENT_LLM_KEY}
AGENT_LLM__API_KEY_HEADER=${KEY_HEADER}
# AMP_COMPLETE
EOF

if [ -f "$OUT" ]; then
  grep -v '^AMP_\|^AGENT_LLM__BASE_URL\|^AGENT_LLM__ANTHROPIC_API_KEY\|^AGENT_LLM__API_KEY_HEADER\|^# The agent talks to its AMP\|^# for that proxy; the real\|^# Generated by init/amp-init\|^# AMP_COMPLETE\|^# The agent talks\|^# the gateway; the real\|^# Hash of the Anthropic' \
    "$OUT" >> "$tmp" || true
fi
mv "$tmp" "$OUT"

cat <<EOF

================ Apex — AMP ready ================
  Org / project   ${ORG} / ${PROJECT}
  Agent           ${AGENT_NAME} (external)
  LLM proxy       ${PROXY_URL}
  Credentials     ${OUT}
==================================================
EOF
