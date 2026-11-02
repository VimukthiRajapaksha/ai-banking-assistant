# Running Apex Bank locally

Everything in this repository runs on one machine under Docker Compose,
next to a local **WSO2 Agent Manager** (AMP). Identity is the **ThunderID**
instance that comes with Agent Manager, the bank's API sits behind **WSO2 API
Manager**, and consents are stored in **WSO2 OpenFGC**.

## What runs where

| Component | Provided by | Runs as |
|---|---|---|
| Bank portal + chat widget (`apps/portal`) | this repo | `ui`, port 18000 |
| Banking agent (`agents/banking-assistant`) | this repo | `agent`, port 18020 |
| Banking MCP server (`mcp-servers/banking`) | this repo | `mcp-server`, port 18010 |
| Mock bank API (`backends/mock-bank`) | this repo | `mock-backend`, port 18030 |
| Reverse proxy | this repo (`caddy/Caddyfile`) | `caddy`, port 80 |
| WSO2 API Manager 4.7.0 | `wso2/wso2am:4.7.0` image, config in `apim/` | `apim`, ports 8243 / 8280 / 9443 |
| OpenFGC consent server, portal BFF and portal | [wso2/openfgc](https://github.com/wso2/openfgc), fetched by `scripts/fetch-openfgc.sh` | `consent-server` 18040, `consent-bff` 18050, `consent-portal` 18060 |
| **WSO2 Agent Manager** | [wso2/agent-manager](https://github.com/wso2/agent-manager), **installed separately** | k3d cluster on the host |
| ThunderID | ships with Agent Manager | `thunder.amp.localhost:8080` |
| One-shot provisioners | this repo (`init/`) | `thunder-init`, `amp-init`, `apim-init`, `consent-init` |

Caddy gives each service a hostname: `portal.apex.localhost`,
`agent.apex.localhost`, `mcp.apex.localhost`, `bank.apex.localhost`,
`consent.apex.localhost` and `portal.consent.apex.localhost`. Browsers resolve
`*.localhost` to 127.0.0.1 on their own, so `/etc/hosts` needs no changes.

## Prerequisites

1. **WSO2 Agent Manager, running.** Install and configure it by following
   [its own setup](https://github.com/wso2/agent-manager); this repository does
   not cover that. Agent Manager provides ThunderID, the LLM gateway the agent
   calls the model through, and the trace collector. Before going further,
   check that both of these answer:
   - `http://thunder.amp.localhost:8080/.well-known/openid-configuration`
   - `http://localhost:9000/healthz`
2. **Docker** with Compose v2, plus `git`, `curl` and `jq` on the host. Give the
   Docker VM at least 6 GB of memory: APIM alone takes about 2 GB.
3. **An Anthropic API key.** The key goes on an AMP LLM provider. The agent
   gets an AMP proxy URL and proxy key instead, never the provider key.

The rest needs no manual setup:

- **WSO2 API Manager** runs from the official image. `init/apim-init.sh`
  publishes the bank API (`/bank/v1.0`, every resource bound to the ThunderID
  scope that guards it). It also registers ThunderID as the key manager,
  deploys a revision to the gateway, and maps the ThunderID client to an APIM
  application. You do not need to create the API proxy in the Publisher.
- **OpenFGC** is cloned from [wso2/openfgc](https://github.com/wso2/openfgc)
  at a pinned commit of its `feature/portal` branch. That branch is not
  released yet, and only it has the consent portal and its BFF.
  `consent/openfgc-portal.patch` is applied on top: it adds the payment
  details card and the user labels the Apex consents need.

## Step 1: create one ThunderID credential by hand

The provisioners cannot create their own credential. An application cannot
grant itself the role it needs, ThunderID's DCR is permission-gated, there is
no password grant, and unauthenticated writes are refused. So create one
client once, in the ThunderID console that comes with Agent Manager:

1. Create an **M2M** application (`client_credentials` only).
2. Give it the **Administrators** and **Agent Manager Admins** groups, or a
   role that grants `system` on the System resource server.
3. In its **access token attributes**, add `ouId` and `ouHandle`. Without
   them, AMP rejects its tokens whatever scopes they carry.

Keep the client ID and secret for the next step.

## Step 2: configure

```bash
cp deploy/local/.env.example deploy/local/.env
```

| Variable | What it is |
|---|---|
| `THUNDER_BASE_URL` | ThunderID, `http://thunder.amp.localhost:8080` |
| `THUNDER_CLIENT_ID` / `THUNDER_CLIENT_SECRET` | The Step 1 application |
| `AMP_BASE_URL` | The Agent Manager API as seen from a container, `http://host.docker.internal:9000` |
| `ANTHROPIC_API_KEY` | Put on the AMP LLM provider; never reaches the agent |
| `APEX_USER_PASSWORD` | Password for the customer account the provisioner creates |
| `AMP_NPI_GUARDRAIL` | `enforce` (default), `monitor` or `off`. Only takes effect with the custom gateway (Step 3) |
| `AMP_TOKEN_LIMITS` | The agent's token budget on its LLM proxy, e.g. `60000/1m,1000000/1h`, or `off` |
| `AMP_QUALITY_MONITOR` / `AMP_MONITOR_INTERVAL_MINUTES` | AMP evaluation monitor: `on` or `off`, and how often it runs |
| `OTEL_TRACES_SAMPLER_ARG` | Fraction of chats traced to AMP (`1.0` = all) |

That is the only file you edit. Two others:

- `deploy/local/env/<service>.env` holds each service's settings.
  `scripts/start.sh` creates it from the committed `<service>.env.example` on
  the first run. The defaults are already correct for this stack, so you only
  edit it to change something like the model (`AGENT_LLM__MODEL`).
- `deploy/local/.env.generated` is written by the provisioners: client
  secrets, flow secrets, consent purpose IDs, the APIM gateway URL and the AMP
  proxy key. Never edit it, and never commit it.

## Step 3 (optional): the NPI masking guardrail

The agent's model traffic can pass through a custom AMP gateway policy. It
masks account numbers, IDs, card data and contact details before they reach the
LLM, and restores them in the reply. It needs the `ap` CLI and a checkout of
`wso2/agent-manager`, and is done once per Agent Manager install:

```bash
EXTENSION_CHART=<agent-manager>/deployments/helm-charts/wso2-amp-api-platform-gateway-extension \
  gateway-policies/deploy-amp-gateway.sh
```

See [gateway-policies/README.md](../../gateway-policies/README.md). If you skip
this step, `amp-init` notices the stock gateway and does not attach the
guardrail. Everything else still works.

## Step 4: start

```bash
scripts/start.sh
```

It:

1. fetches OpenFGC and applies the patch (`scripts/fetch-openfgc.sh`);
2. checks the prerequisites (`scripts/check-prereqs.sh`);
3. runs the provisioners in order: ThunderID → AMP → OpenFGC → APIM. The first
   run waits a few minutes for APIM to boot;
4. starts the services;
5. checks every hop (`scripts/doctor.sh`).

Re-running it is safe. Every provisioner adopts what already exists and never
rotates a secret that is already recorded in `.env.generated`.

The provisioners run first because Compose reads each service's env files when
it creates the container, which is before any provisioner has written
`.env.generated`. Running `docker compose up` on a fresh clone would therefore
start the agent and MCP server without their credentials. Use `start.sh`.

## Step 5: sign in

Open **http://portal.apex.localhost** and sign in as `alex@apexbank.com` with
`APEX_USER_PASSWORD`. Then try:

- "What are my account balances?" The first question asks for consent in the
  chat. Approved consents are listed at http://portal.consent.apex.localhost.
- **Payments need a passkey.** Open **Settings** (the gear icon), and set one
  up. The portal signs you out, you sign in again on ThunderID's page, and the
  browser asks for your fingerprint, face or screen lock. After that, "Pay Sam
  Lee $20" asks for the passkey and for a confirmation card, then pays. The
  balance really drops, until the mock bank restarts.

To add customers, use the ThunderID console or add a document to
`init/thunder/83-apex-user.yaml`.

## Day to day

| Task | Command |
|---|---|
| Check every hop | `scripts/doctor.sh` |
| Logs of one service | `docker compose -f deploy/local/docker-compose.yml logs -f agent` |
| Stop (keeps APIM's database and the consents) | `scripts/stop.sh` |
| Stop and wipe that data | `scripts/stop.sh --purge` (the next start re-provisions APIM and OpenFGC) |
| Rebuild one service after a code change | `docker compose -f deploy/local/docker-compose.yml up -d --build --no-deps agent` |

The portal and the consent portal run Vite dev servers with their `src/`
mounted, so front-end edits reload without a rebuild.

## How the pieces fit

The point of the system is the token chain. The customer's token is exchanged
for one the agent can use, and that one is exchanged again for one the MCP
server presents to the bank. Each step narrows the scope and records who
acted, so the bank sees `customer → agent → MCP server` instead of an
anonymous service call.

Everything is on one ThunderID resource server, `urn:apex`. ThunderID keeps
only the scopes of the one resource server a token's `resource` parameter
names, and an exchange can only narrow what the subject token already holds.
The customer's sign-in token therefore requests every scope any later hop
will need. The permission prefixes tell the services apart: `apex:bank:*`,
`apex:agent:*`, `apex:mcp-*`, `apex:portal:*`.

- **Consent.** The MCP server checks OpenFGC before each tool runs. If the
  customer has not approved what the tool is about to do, it creates a consent
  and returns a form instead. It can create consents but never approve them.
- **APIM** validates the bearer token and the scope on each resource. A
  read-only token gets `200` on `GET /accounts` and `403` on
  `POST /accounts/{id}/payments`.
- **Payments** ask twice. First a passkey ceremony, which the MCP server starts
  against ThunderID and the browser completes. Then a card that states payee,
  amount, reference and funding account. Approving the card records a
  single-use consent. Only then is a token minted with
  `apex:bank:payments:write` and nothing else.
- **Single sign-on.** The bank portal and the consent portal use the same
  ThunderID flow (`apex-login`), so signing in to one signs you in to both.
  ThunderID scopes SSO to a flow, not to the server.

## Troubleshooting

- **A provisioner fails.** Run
  `docker compose -f deploy/local/docker-compose.yml logs <thunder-init|amp-init|apim-init|consent-init>`.
  Each one prints the call that failed and the reason.
- **Everything returns 500 or times out after a Colima or k3d restart.** Agent
  Manager needs its own restart steps first: start its containers, restore its
  port-forwards, and restore its CoreDNS host aliases. See "Things the docs do
  not tell you" in [gateway-policies/README.md](../../gateway-policies/README.md).
- **Vite exits with `EMFILE` at startup.** The container's file watcher ran
  out of descriptors. Both portals are already set to poll instead
  (`VITE_USE_POLLING`, `consent/vite.docker.config.ts`). Keep that setting if
  you change the compose file.
- **A container cannot reach `thunder.amp.localhost`.** Inside a container,
  `*.localhost` means the container itself. Compose maps the name to the host
  with `extra_hosts`. curl ignores that mapping, so `init/entrypoint.sh`
  writes `--connect-to` rules for the provisioners.
- **Bank calls return 404 from APIM.** The API is published but no revision is
  deployed. Re-run `scripts/start.sh`.
- **Bank calls return 403 on every resource.** The key manager's
  `consumerKeyClaim` must be `client_id`, which is where ThunderID puts it.
  `apim-init.sh` sets this. If you edit the key manager by hand, keep it.
- **The browser warns about a certificate on port 8243.** APIM's certificate
  is self-signed. The portal reaches APIM through Caddy (`/bank-api`), so a
  browser should never need to open 8243. The MCP server's TLS verification is
  turned off for this stack only.
- **The payment says a passkey is required.** Set one up first, from
  **Settings**. A password is not a step-up: it is the same factor used to sign
  in.
