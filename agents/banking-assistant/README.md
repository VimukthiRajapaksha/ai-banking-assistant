# AI Banking Agent

The conversational service behind the chat widget. It runs the LLM loop, decides
which bank operations a question needs, and calls them as tools on the MCP
server.

It never acts on its own authority. The caller's token becomes the *subject* of
an RFC 8693 exchange and this agent's own token the *actor*, so every downstream
call carries both identities: the customer it is for, and the agent doing it.
When the MCP server needs consent, this service relays the request to the
browser and relays the customer's answer back verbatim — it does not answer on
their behalf.

## Directory structure

```
src/ai_banking_agent/
  server.py           FastAPI app; the /chat endpoint
  chat_agent.py       The pydantic-ai agent, its tool definitions, and the
                      PLAN line naming the tools a turn will need so one
                      consent can cover the whole turn
  mcp_client.py       One-shot MCP tool calls; raises ConsentRequired
  sessions.py         Per-conversation state, bound to the caller's subject
  settings.py         Environment configuration
  telemetry.py        Tracing and the session/trace/span log stamps
  logging_context.py  Log formatting
  identity/
    self_auth.py      This agent proving its own identity (Agent Identity)
    token_exchange.py Delegated exchange for an MCP-audience token
    jwt_utils.py      Unverified claim decoding, for binding only
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values.

| Variable | What it is |
|---|---|
| `AGENT_IDENTITY__DISCOVERY_URL` | OIDC discovery document; the authorize and token endpoints are derived from it |
| `AGENT_IDENTITY__CLIENT_ID` | Client ID of this agent's OAuth application |
| `AGENT_IDENTITY__CLIENT_SECRET` | Its client secret |
| `AGENT_IDENTITY__AGENT_ID` | Agent Identity id, used for self-authentication only |
| `AGENT_IDENTITY__AGENT_SECRET` | Agent Identity secret, used for self-authentication only |
| `AGENT_IDENTITY__AUTHN_ENDPOINT` | WSO2-native `/oauth2/authn`; no discovery equivalent, so it stays explicit |
| `AGENT_IDENTITY__REDIRECT_URI` | This agent's OAuth callback, registered byte-identically on the app |
| `AGENT_IDENTITY__SELF_SCOPE` | Scopes on the agent's own actor token. An exchange is bounded by both the subject's and the actor's grants |
| `AGENT_MCP__SERVER_URL` | The MCP server to call |
| `AGENT_MCP__AUDIENCE` | The MCP server's resource identifier; the `audience` of the delegated token |
| `AGENT_MCP__SCOPES` | Scopes requested on the delegated token. The exchange narrows but never widens, so these must already be on the caller's token |
| `AGENT_LLM__ANTHROPIC_API_KEY` | API key for the conversational model |
| `AGENT_LLM__MODEL` | Model powering the conversation |
| `AGENT_LLM__BASE_URL` | Optional. Anthropic-compatible endpoint to call instead of `api.anthropic.com` (e.g. a gateway) |
| `AGENT_LLM__API_KEY_HEADER` | Optional. Header the endpoint reads the key from when it is not `x-api-key` (AMP's per-agent LLM proxy uses `API-Key`) |
| `AGENT_FRONTEND__ORIGIN` | Browser origin allowed to call `/chat` (CORS) |
| `AGENT_ENV` | Runtime environment. Also selects the env file: `development` → `.env`, `staging` → `.env.staging`, `production` → `.env.production` |
| `AGENT_HOST` / `AGENT_PORT` | Where this service listens. Default `0.0.0.0:18020` |

## Running

```bash
uv sync
uv run ai-banking-agent
```
