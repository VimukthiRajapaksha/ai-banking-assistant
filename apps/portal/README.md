# AI Banking UI

The customer-facing dashboard, and the only place a human is ever asked to
approve anything. It signs the customer in with Asgardeo, shows their accounts,
and hosts the chat widget that talks to the AI banking agent.

When the agent needs consent, this app renders the request and — importantly —
approves it against the consent service under the customer's *own* token. No
other service in the system is able to do that.

## Directory structure

```
src/
  api/            Outbound calls, one client per audience
    bankClient.ts     bank APIs, using the sign-in token
    chatClient.ts     the agent's /chat, using the exchanged token
    consentClient.ts  approves the customer's own pending consent
    httpClient.ts     shared authed fetch; mints the W3C traceparent
    session.ts        browser-minted session id, sent as W3C baggage
  auth/
    tokenExchange.ts     RFC 8693 exchange for an agent-audience token
    useIdTokenProfile.ts name and subject, read from the ID token
  chat-widget/    The chat panel, including the inline consent form
  components/     Dashboard tables, glass surfaces, nav and app bar
  hooks/          Bank data fetching, one hook per resource
  format.ts       Money and date formatting, shared by every table
  pages/          Dashboard
  config.ts       Reads and validates VITE_* environment variables
  theme.ts        Oxygen UI theme
```

## Environment variables

Copy `.env.example` to `.env` and fill in the values.

| Variable | What it is |
|---|---|
| `VITE_AUTH__BASE_URL` | Asgardeo organization base URL |
| `VITE_AUTH__CLIENT_ID` | Client ID of this single-page application |
| `VITE_AUTH__AFTER_SIGN_IN_URL` | Redirect URL after sign-in, registered byte-identically on the app |
| `VITE_AUTH__AFTER_SIGN_OUT_URL` | Where to land after sign-out |
| `VITE_AUTH__LOGIN_SCOPES` | Scope envelope requested at sign-in. A delegated exchange narrows but never widens, so every scope any downstream hop needs must be granted here |
| `VITE_AUTH__AGENT_AUDIENCE` | Resource identifier of the agent's chat API; the `audience` of the exchanged token |
| `VITE_AUTH__AGENT_SCOPES` | Scopes requested on the exchanged token |
| `VITE_BANK_API__BASE_URL` | Root of the bank's API, called directly with the sign-in token |
| `VITE_AGENT__CHAT_URL` | The agent's `/chat` endpoint |
| `VITE_CONSENT__BASE_URL` | Consent service base. Left as `/consent-api` so Vite proxies it — the service sends no CORS headers |
| `VITE_CONSENT__ORG_ID` | `org-id` header the consent service requires |
| `VITE_CONSENT__GROUP_ID` | `group-id` header the consent service requires |

## Running

```bash
npm install
npm run dev -- --port 18000
```

Then open `http://localhost:18000`.

To build and serve the production bundle instead:

```bash
npm run build
npm run preview -- --port 18000
```
