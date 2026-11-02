# Gateway policies

Custom WSO2 API Platform gateway policies for Apex, and the build that puts them
into Agent Manager's gateway. Laid out like
[`wso2/gateway-controllers`](https://github.com/wso2/gateway-controllers), so the
folder can move to its own repository unchanged.

| Path | What it is |
|---|---|
| `policies/npi-masking-regex/` | The NPI masking guardrail (Go module) |
| `docs/npi-masking-regex/v0.1/` | User documentation and catalogue metadata |
| `design/npi-masking-regex.md` | Design and the decisions behind it |
| `build/build.yaml` | Gateway build: the stock 1.2.1 policy set plus `npi-masking-regex` |
| `deploy-amp-gateway.sh` | Builds the images and runs them as AMP's gateway |

## npi-masking-regex

Masks banking Nonpublic Personal Information in what the agent sends to the LLM
and restores it in what comes back. Only values are replaced, never their keys,
so the agent can still pass a value it got from one tool into the next tool,
even though the LLM only ever saw a placeholder. See the
[user docs](docs/npi-masking-regex/v0.1/docs/npi-masking-regex.md).

## Test

```bash
cd policies/npi-masking-regex
go test -race ./...
go test -run '^$' -fuzz FuzzMaskRestore -fuzztime 30s .
go test -run '^$' -bench . -benchmem .
```

## Build and deploy to Agent Manager

Prerequisites: the AMP k3d setup running; the `ap` CLI v0.9.1+
([release](https://github.com/wso2/api-platform/releases/tag/ap%2Fv0.9.1));
a checkout of `wso2/agent-manager` for the gateway extension chart.

```bash
EXTENSION_CHART=<agent-manager>/deployments/helm-charts/wso2-amp-api-platform-gateway-extension \
  ./deploy-amp-gateway.sh
```

Then starting the local stack (`scripts/start.sh`, see `deploy/local/README.md`) attaches the
guardrail to the Apex agent's model config (agent-level "Guardrails", enforced on
the agent's AMP LLM proxy) via `deploy/local/init/amp-init.sh`.

The script:

1. Builds the images with `ap gateway image build`.
2. Retags them with a hash of the policy source, so every change rolls out.
3. Loads them into k3d.
4. Points the gateway operator at them.
5. Wires the `hmacKey` system parameter to a generated Kubernetes Secret.
6. Rolls the existing `APIGateway`.

It is idempotent. `--skip-build` reuses the last build.

| Variable | Default | What it is |
|---|---|---|
| `EXTENSION_CHART` | — (required) | Path to AMP's `wso2-amp-api-platform-gateway-extension` chart |
| `AP` | `ap` | The `ap` CLI binary |
| `GATEWAY_NAME` | `apex` | Image name prefix |
| `IMAGE_REPOSITORY` | `apex.local` | Image repository |
| `K3D_CLUSTER` | `openchoreo-local-setup` | k3d cluster to load the images into |
| `GW_NAMESPACE` / `GW_RELEASE` / `GW_CR` | `default-default` / `api-platform-default-default` / same | AMP gateway namespace, Helm release and `APIGateway` |
| `OPERATOR_NAMESPACE` | `openchoreo-data-plane` | Gateway operator namespace |
| `HMAC_SECRET` | `npi-masking-regex-hmac` | Secret holding the placeholder key; never rotated by the script |

## Things the docs do not tell you

- **`build.yaml` replaces the gateway's policy set; it does not add to it.**
  `build/build.yaml` therefore lists the exact set baked into the stock 1.2.1
  image, read from its `/app/build-manifest.yaml` and pinned to those versions.
- **`ap … --platform` pushes.** It switches to buildx with push, which fails
  for a local repository. Omit it to build for the host platform and keep the
  images local.
- **A custom controller image needs `definitions_path=/app/policies`.** The
  builder puts every definition in `/app/policies` and expects `config.toml` to
  read that path from an env var. The gateway Helm chart writes the literal
  `./default-policies` (stock definitions only). Without the override, the
  custom policy runs but is never advertised, so Agent Manager never lists it.
- **AMP lists a guardrail only if every active gateway in the org reports it.**
- **Agent-level vs provider-level.** An agent-level guardrail runs only on the
  agent's LLM proxy route. The proxy takes its key in an `API-Key` header, not
  the provider's `X-API-Key`. Provider-level guardrails also apply to proxy
  traffic. Don't attach this policy at both levels.
- **After a Colima/k3d restart**, AMP needs three things before anything works:
  1. Start its containers: `docker start agent-manager-db agent-manager-service agent-manager-console`.
  2. Restore its port-forwards: `setup/port-forward.sh --background`.
  3. Restore its in-cluster host aliases: `ensure_coredns_host_aliases` from
     `setup/utils.sh`, then `kubectl rollout restart deployment/coredns -n kube-system`.

  Without them, AMP cannot reach OpenChoreo (every project call returns 500), and the
  gateway cannot reach AMP (its guardrail catalogue stays empty, and Helm
  bootstrap hooks hang).
- **Re-running AMP's own setup** (`ensure-gateway-operator.sh`) resets the
  operator to the stock images. Run `deploy-amp-gateway.sh` again afterwards.
