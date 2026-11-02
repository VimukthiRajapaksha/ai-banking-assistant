# AI Banking Assistant

An AI banking assistant for **Apex Bank**. A customer signs in to the bank
portal and chats with an agent. The agent reads accounts, transactions, payees
and products, and makes payments for the customer. Each call is delegated from
the customer's own token, gated by consent, and stepped up with a passkey
before money moves.

This branch, `development-local`, runs the whole solution on one machine with
Docker Compose, next to a local [WSO2 Agent Manager](https://github.com/wso2/agent-manager).
The version built for AMP Cloud is on `development`.

## Run it locally

See **[deploy/local/README.md](deploy/local/README.md)**. In short:

1. Install and start [WSO2 Agent Manager](https://github.com/wso2/agent-manager).
   It is configured separately and is not covered here. It also provides the
   ThunderID instance this stack signs in with.
2. Create one ThunderID M2M application by hand (Step 1 in that README).
3. `cp deploy/local/.env.example deploy/local/.env`, then fill it in.
4. `scripts/start.sh`
5. Open http://portal.apex.localhost.

`start.sh` provisions everything else: the ThunderID applications, roles and
customer; the agent's AMP registration and LLM proxy; the bank API on WSO2 API
Manager; and the consent model on [WSO2 OpenFGC](https://github.com/wso2/openfgc).

## Layout

| Path | What it is |
|---|---|
| `agents/banking-assistant/` | Chat agent (Python). Exchanges the customer's token for a delegated one and calls the MCP server. |
| `mcp-servers/banking/` | Banking MCP server (Python). Accounts, transactions, payees, payments; consent gate and payment step-up. |
| `apps/portal/` | Bank portal and chat widget (React + Vite). |
| `backends/mock-bank/` | Mock Open Banking-style bank API (Node). |
| `specs/bank-api.yaml` | OpenAPI spec of the bank API. |
| `deploy/local/` | The local stack: Compose file, Caddy, APIM config, OpenFGC build and patch, per-service settings, and the provisioners (`init/`). |
| `gateway-policies/` | Optional AMP gateway guardrail that masks banking data before it reaches the LLM. |
| `scripts/` | `start.sh`, `stop.sh`, `doctor.sh`, `check-prereqs.sh`, `fetch-openfgc.sh`. |

Every component has its own `Dockerfile`, `.env.example` and `README.md`, so it
can also be built and run on its own.
