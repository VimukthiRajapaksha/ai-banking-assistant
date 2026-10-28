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

Locally, copy `.env.example` to `.env`. On the WSO2 Developer Platform, mount
`config.js` per environment from `config.js.example`: Vite bakes `.env` in at
build time, which the platform does not support for SPAs, so `src/config.ts`
reads `window.configs` from `config.js` first and `.env` as the fallback. Same
keys in both.

| Variable | Required | Used for |
|---|---|---|
| `VITE_AUTH__BASE_URL` | yes | ThunderID's base URL: sign-in, tokens, and sign-out (`/oauth2/logout`) |
| `VITE_AUTH__CLIENT_ID` | yes | The portal's ThunderID application (`apex-portal-client`) |
| `VITE_AUTH__AFTER_SIGN_IN_URL` | yes | Where ThunderID returns after sign-in; registered byte-identically on the app. Its path is the route that completes sign-in |
| `VITE_AUTH__AFTER_SIGN_OUT_URL` | yes | Where ThunderID returns after sign-out |
| `VITE_AUTH__LOGIN_SCOPES` | yes | Every permission requested at sign-in. A delegated exchange narrows but never widens, so each scope a downstream hop needs must be granted here |
| `VITE_AUTH__AUDIENCE` | yes | Resource indicator sent at sign-in (`urn:apex`); the token's audience |
| `VITE_BANK_API__BASE_URL` | yes | Root of the bank's API, called directly with the sign-in token |
| `VITE_AGENT__BASE_URL` | no | The agent's root. The app calls `<base>/chat` (assistant) and `<base>/security/passkey` (passkey enrolment). Empty means the portal's own origin |
| `VITE_CONSENT__PORTAL_URL` | no | Link to the consent portal in the account menu; hidden when unset |

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
