# AI Banking MCP Server

Exposes the bank's operations to the agent as MCP tools: accounts, transactions
and payments. This is where consent is decided — before a tool runs, it checks
whether the customer has already approved what the tool is about to do, and if
not it returns a form for them to answer rather than proceeding.

It creates consent records but can never approve one; only the customer can,
from their own browser. Tokens presented to it are verified against the IdP and
exchanged for a bank-audience token that keeps the `act` chain intact, so the
bank's gateway can see both who the call is for and who is making it.

## Directory structure

```
src/ai_banking_mcp_server/
  server.py         Builds the MCP server and registers the tools
  settings.py       Environment configuration
  state.py          Per-session token cache, pending authorizations, locks
  telemetry.py      Tracing and the session/trace/span log stamps
  tools/
    accounts.py       get_accounts
    transactions.py   get_transactions
    payments.py       make_payment
    catalog.py        Which scopes and permissions each tool needs, so one
                      consent can cover every tool a turn will use
    consent_gate.py   The shared check that runs before any tool
  inbound/
    token_verifier.py Verifies the tokens agents present to this server
  outbound/
    token_exchange.py Delegated exchange for a bank-audience token
    consent.py        Consent service client (create, find, validate)
    accounts.py       The bank's account and balance calls
    transactions.py   The bank's transaction calls
    payments.py       The bank's payment call
    client.py         Shared authenticated HTTP client
    oauth.py          Discovery and OAuth helpers
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values.

| Variable | What it is |
|---|---|
| `MCP_INBOUND_OAUTH__DISCOVERY_URL` | OIDC discovery document used to verify inbound tokens |
| `MCP_INBOUND_OAUTH__AUDIENCE` | Audience inbound tokens must carry: this server's own resource identifier (RFC 8707) |
| `MCP_INBOUND_OAUTH__REQUIRED_SCOPES` | Scopes every inbound token must have |
| `MCP_INBOUND_OAUTH__RESOURCE_SERVER_URL` | This server's resource identifier, published in its protected-resource metadata |
| `MCP_OUTBOUND_OAUTH__DISCOVERY_URL` | Discovery document for the bank's IdP, which may be a different tenant |
| `MCP_OUTBOUND_OAUTH__CLIENT_ID` | Client ID this server uses towards the bank |
| `MCP_OUTBOUND_OAUTH__CLIENT_SECRET` | Its client secret |
| `MCP_OUTBOUND_OAUTH__REDIRECT_URI` | This server's OAuth callback |
| `MCP_OUTBOUND_OAUTH__SCOPE` | Scopes requested on the bank token |
| `MCP_OUTBOUND_OAUTH__AUDIENCE` | The bank's resource identifier; the `audience` of the exchanged token |
| `MCP_OUTBOUND_API__BASE_URL` | Root of the bank's API. Every resource is a path beneath it, so there is one value to change and no way for two of them to drift apart |
| `MCP_CONSENT__BASE_URL` | Consent service base URL |
| `MCP_CONSENT__ORG_ID` / `MCP_CONSENT__GROUP_ID` | Headers the consent service requires on every call |
| `MCP_CONSENT__ACCOUNT_ACCESS_PURPOSE_ID` / `_NAME` | The purpose consents for reading account data are created against |
| `MCP_CONSENT__PAYMENT_PURPOSE_ID` / `_NAME` | The purpose payment authorizations are created against |
| `MCP_CONSENT__ELEMENT_NAMESPACE` | Namespace for consent elements |
| `MCP_CONSENT__VALIDITY_SECONDS` | How long an account-access consent stays valid |
| `MCP_CONSENT__PAYMENT_VALIDITY_SECONDS` | How long a payment authorization stays valid. Deliberately short — it authorises one payment |
| `MCP_ENV` | Runtime environment. Also selects the env file: `development` → `.env`, `staging` → `.env.staging`, `production` → `.env.production` |
| `MCP_HOST` / `MCP_PORT` | Where this service listens. Default `0.0.0.0:18010` |

## Running

```bash
uv sync
uv run ai-banking-mcp-server
```
