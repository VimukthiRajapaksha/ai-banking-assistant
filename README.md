# AI Banking Assistant

An AI banking assistant for **Apex Bank**. A customer signs in to the bank
portal and chats with an agent. The agent reads accounts, transactions, payees
and products, and makes payments for the customer. Each call is delegated from
the customer's own token, gated by consent, and stepped up with a passkey
before money moves.

This branch holds the version built to run on WSO2 Agent Manager (AMP) Cloud,
with ThunderID as the identity provider.

## Layout

| Path | What it is |
|---|---|
| `agents/banking-assistant/` | Chat agent (Python). Exchanges the customer's token for a delegated one and calls the MCP server. |
| `mcp-servers/banking/` | Banking MCP server (Python). Accounts, transactions, payees, payments; consent gate and payment step-up. |
| `apps/portal/` | Bank portal and chat widget (React + Vite). |
| `backends/mock-bank/` | Mock Open Banking-style bank API (Node). |
| `specs/bank-api.yaml` | OpenAPI spec of the bank API. |
| `platform/identity/thunderid/` | ThunderID import bundle: resource server, flows, applications, users and roles. |

Every component is self-contained: it has its own `Dockerfile`, `.env.example`
and `README.md`, so each one can be built from its own folder.

## Getting started

1. Provision ThunderID from `platform/identity/thunderid/` (see its README).
2. For each component, copy `.env.example` to `.env` and fill it in. The
   component's README covers its settings.
