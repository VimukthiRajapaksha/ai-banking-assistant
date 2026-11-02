#!/usr/bin/env bash
# Builds the Apex gateway (stock 1.2.1 policies + npi-masking-regex) and runs it
# as Agent Manager's gateway on the local k3d cluster.
#
# Every step is the documented one:
#   build    build/build.yaml + `ap gateway image build`
#            (docs-api-platform: policies/custom-policies/building-gateway-with-custom-policies.md)
#   images   the gateway operator's gateway.values.gateway.{controller,gatewayRuntime}.image
#            values, as AMP's installation guide sets them
#   secret   the AMP gateway chart's apiGateway.config.config_toml + systemExtraEnv,
#            backed by a Kubernetes Secret, for the policy's hmacKey system parameter
#   rollout  bump spec.infrastructure.annotations so the operator re-renders the
#            existing APIGateway (gateway-operator README, "Updating an existing gateway")
#
# Idempotent. Usage: ./deploy-amp-gateway.sh [--skip-build]
#
# Note: re-running AMP's own setup (ensure-gateway-operator.sh) resets the
# operator to the stock ghcr images; run this script again afterwards.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

AP="${AP:-ap}"
GATEWAY_NAME="${GATEWAY_NAME:-apex}"
IMAGE_REPOSITORY="${IMAGE_REPOSITORY:-apex.local}"
GATEWAY_VERSION="$(awk '/^gateway:/{g=1} g && /version:/{gsub(/"/,"",$2); print $2; exit}' "${HERE}/build/build.yaml")"
K3D_CLUSTER="${K3D_CLUSTER:-openchoreo-local-setup}"
GW_NAMESPACE="${GW_NAMESPACE:-default-default}"
GW_RELEASE="${GW_RELEASE:-api-platform-default-default}"
GW_CR="${GW_CR:-api-platform-default-default}"
OPERATOR_NAMESPACE="${OPERATOR_NAMESPACE:-openchoreo-data-plane}"
OPERATOR_CHART="${OPERATOR_CHART:-oci://ghcr.io/wso2/api-platform/helm-charts/gateway-operator}"
EXTENSION_CHART="${EXTENSION_CHART:?set EXTENSION_CHART to agent-manager/deployments/helm-charts/wso2-amp-api-platform-gateway-extension}"
HMAC_SECRET="${HMAC_SECRET:-npi-masking-regex-hmac}"

CONTROLLER_IMAGE="${IMAGE_REPOSITORY}/${GATEWAY_NAME}-gateway-controller"
RUNTIME_IMAGE="${IMAGE_REPOSITORY}/${GATEWAY_NAME}-gateway-runtime"

say() { printf '==> %s\n' "$*"; }
die() { printf '!! %s\n' "$*" >&2; exit 1; }

# -------------------------------------------------------------------- build
if [ "${1:-}" != "--skip-build" ]; then
  command -v "$AP" >/dev/null || die "ap CLI not found (set AP=/path/to/ap; v0.9.1+)"
  say "building ${CONTROLLER_IMAGE}:${GATEWAY_VERSION} and ${RUNTIME_IMAGE}:${GATEWAY_VERSION}"
  (cd "${HERE}/build" && "$AP" gateway image build --name "$GATEWAY_NAME" --repository "$IMAGE_REPOSITORY")
fi
docker image inspect "${CONTROLLER_IMAGE}:${GATEWAY_VERSION}" "${RUNTIME_IMAGE}:${GATEWAY_VERSION}" >/dev/null 2>&1 ||
  die "images not found locally; run without --skip-build"

# ap tags images with the gateway version alone, so a rebuilt policy would keep
# the same tag and never roll out. Retag with a hash of the build inputs: an
# immutable tag per policy change, and an unchanged one when nothing changed.
SOURCE_HASH="$(cd "$HERE" && find build/build.yaml policies -type f ! -path '*/testdata/*' ! -name '*_test.go' -print0 |
  LC_ALL=C sort -z | xargs -0 cat | { sha256sum 2>/dev/null || shasum -a 256; } | cut -c1-10)"
IMAGE_TAG="${GATEWAY_VERSION}-${SOURCE_HASH}"
docker tag "${CONTROLLER_IMAGE}:${GATEWAY_VERSION}" "${CONTROLLER_IMAGE}:${IMAGE_TAG}"
docker tag "${RUNTIME_IMAGE}:${GATEWAY_VERSION}" "${RUNTIME_IMAGE}:${IMAGE_TAG}"
say "image tag ${IMAGE_TAG}"

# ------------------------------------------------------------------- images
# A local registry name the cluster cannot pull from, so the images are loaded
# into the k3d node directly. Push to a real registry instead outside k3d.
say "importing images into k3d cluster ${K3D_CLUSTER}"
k3d image import -c "$K3D_CLUSTER" "${CONTROLLER_IMAGE}:${IMAGE_TAG}" "${RUNTIME_IMAGE}:${IMAGE_TAG}"

# --------------------------------------------------------------- operator
say "pointing the gateway operator at the custom images"
helm upgrade gateway-operator "$OPERATOR_CHART" -n "$OPERATOR_NAMESPACE" \
  --version "$(helm list -n "$OPERATOR_NAMESPACE" -f '^gateway-operator$' -o json | jq -r '.[0].chart | sub("^gateway-operator-"; "")')" \
  --reuse-values \
  --set "gateway.values.gateway.controller.image.repository=${CONTROLLER_IMAGE}" \
  --set "gateway.values.gateway.controller.image.tag=${IMAGE_TAG}" \
  --set "gateway.values.gateway.controller.image.pullPolicy=IfNotPresent" \
  --set "gateway.values.gateway.gatewayRuntime.image.repository=${RUNTIME_IMAGE}" \
  --set "gateway.values.gateway.gatewayRuntime.image.tag=${IMAGE_TAG}" \
  --set "gateway.values.gateway.gatewayRuntime.image.pullPolicy=IfNotPresent" \
  --set "gateway.values.gateway.config.controller.policies.definitions_path=/app/policies" >/dev/null
# definitions_path: a custom-built controller image keeps ALL its policy
# definitions (stock and custom) in /app/policies and expects config.toml to read
# that from APIP_GW_CONTROLLER_POLICIES_DEFINITIONS_PATH. The gateway Helm chart
# instead renders the literal default "./default-policies" (the stock set only),
# so without this override the controller never loads -- or advertises to AMP --
# the custom policy.
# The operator must be settled before the gateway config changes below: a
# restart mid-reconcile leaves the operator's gateway release locked at
# pending-upgrade ("another operation is in progress").
kubectl rollout status deployment -n "$OPERATOR_NAMESPACE" gateway-operator --timeout=180s >/dev/null

# ------------------------------------------------------------------- secret
if kubectl get secret -n "$GW_NAMESPACE" "$HMAC_SECRET" >/dev/null 2>&1; then
  say "hmac secret ${HMAC_SECRET} exists; left unchanged (rotating it changes every placeholder)"
else
  say "creating hmac secret ${HMAC_SECRET}"
  kubectl create secret generic "$HMAC_SECRET" -n "$GW_NAMESPACE" \
    --from-literal=key="$(openssl rand -hex 32)" >/dev/null
fi

say "wiring the hmacKey system parameter into the gateway config"
values="$(mktemp)"
trap 'rm -f "$values"' EXIT
cat > "$values" <<EOF
apiGateway:
  config:
    config_toml: |
      # npi-masking-regex: placeholder derivation key (policy system parameter hmacKey)
      npi_masking_regex_hmac_key = '{{ env "APIP_GW_NPI_MASKING_HMAC_KEY" }}'
    systemExtraEnv:
      - name: APIP_GW_NPI_MASKING_HMAC_KEY
        valueFrom:
          secretKeyRef:
            name: ${HMAC_SECRET}
            key: key
EOF
helm upgrade "$GW_RELEASE" "$EXTENSION_CHART" -n "$GW_NAMESPACE" --reuse-values -f "$values" >/dev/null

# ------------------------------------------------------------------ rollout
# A default change applies only to new gateways; bumping a spec annotation
# makes the operator re-render the existing one.
say "rolling ${GW_CR}"
kubectl patch apigateway "$GW_CR" -n "$GW_NAMESPACE" --type merge \
  -p "{\"spec\":{\"infrastructure\":{\"annotations\":{\"apex.local/redeploy\":\"$(date +%s)\"}}}}" >/dev/null

for _ in $(seq 1 60); do
  images="$(kubectl get pods -n "$GW_NAMESPACE" -o jsonpath='{range .items[*]}{.spec.containers[*].image}{" "}{.status.phase}{"\n"}{end}')"
  if grep -q "${RUNTIME_IMAGE}:${IMAGE_TAG} Running" <<<"$images" &&
     grep -q "${CONTROLLER_IMAGE}:${IMAGE_TAG} Running" <<<"$images" &&
     [ "$(grep -c -e "${RUNTIME_IMAGE}:" -e "${CONTROLLER_IMAGE}:" -e 'ghcr.io/wso2/api-platform/gateway-' <<<"$images")" -eq 2 ]; then
    kubectl wait --for=condition=Ready pod -n "$GW_NAMESPACE" --field-selector=status.phase=Running --all --timeout=180s >/dev/null
    say "gateway running the custom images"
    exit 0
  fi
  sleep 5
done
die "gateway pods did not switch to the custom images; check: kubectl get pods -n ${GW_NAMESPACE}"
