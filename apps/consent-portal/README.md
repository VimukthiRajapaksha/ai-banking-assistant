# Consent Portal

Where an Apex Bank customer sees what they have allowed the AI assistant to
do. They can approve or reject requests that are waiting for them, and revoke
access at any time.

The consents are stored in **Asgardeo's Consent Management API v2**. The
customer signs in with **ThunderID**, through the same sign-in flow the bank
portal uses, so someone who arrives from the bank portal is not asked to sign
in again.

## How it fits together

```
Bank portal ──"Consents"──► this app (Next.js)
                             ├─ /auth/*        ThunderID sign-in (confidential client, PKCE)
                             ├─ pages          server-rendered from Asgardeo, scoped to the customer
                             └─ /api/consents  approve · reject · revoke
                                      │
                                      └─► Asgardeo /consent-mgt/v2.0  (client credentials)
```

- **Tokens stay on the server.** ThunderID tokens are kept in an encrypted,
  httpOnly session cookie. The Asgardeo client secret is used only on the
  server.
- **Every query is limited to the signed-in customer.** Asgardeo is queried
  with `userId=<sub>&relation=SUBJECT`, where `<sub>` comes from the verified
  ThunderID access token. A single consent is also checked against
  `subjectId`. Another customer's consent returns *not found*, never
  *forbidden*.
- **This app enforces the state rules.** Asgardeo does not check transitions
  (it will re-activate a revoked consent), so `/api/consents/:id/:action`
  re-reads the consent and allows only:
  - approve or reject, while the consent is `PENDING` and the customer's
    authorization is still pending;
  - revoke, while the consent is `ACTIVE`.
- **"Used" and "Replaced" are not "Revoked".** A revoke the customer asks for
  also sets the authorizations to `REVOKED`. A `REVOKED` consent whose
  authorizations were left alone was revoked by someone else:
  - *Used*: an approved payment. A payment consent works once, and the MCP
    server revokes it as soon as the payment goes through.
  - *Replaced*: anything else. Asgardeo keeps one live consent per customer,
    service and purpose, and revokes the older one when a new one is created.

## What a consent shows

- A short title and the status. A payment is titled by payee and amount ("Pay
  Sam Lee $240.75"); account access by the most revealing thing it grants
  ("View your transactions").
- **Who:** the app, the agent, and the customer.
- For a payment: payee, amount, reference, and the account it is paid from.
- **Validity:** when it was requested, when it was decided, and when it ends.
- **Permissions:** each element's name and description, from the purpose
  version.
- **Activity:** a timeline of what happened.
- **About this consent:** what kind it is, why the bank asks for it (the
  purpose's description, when it has one), and a reference ID for support.

The data contract (which properties the MCP server writes) is in
[`platform/consent/asgardeo/README.md`](../../platform/consent/asgardeo/README.md).

## Directory structure

```
src/
  app/
    (portal)/         signed-in pages: overview, consents, consents/[id]
    auth/             login, callback, logout
    api/              consent actions, health
    signed-out/       where a failed sign-in lands
  lib/
    auth/             OIDC (openid-client), session cookie (iron-session)
    asgardeo/         token cache, API client, customer-scoped consent calls
    consent/          view model and the status/action rules (unit-tested)
  components/         shell, consent list/detail/actions
  theme/theme.ts      Apex theme -- KEEP IN SYNC with apps/portal/src/theme.ts
  proxy.ts            session guard and token refresh for every request
```

## Environment variables

Copy `.env.example` to `.env`. Every value is read at run time on the server,
so one build serves every environment.

| Variable | Required | Used for |
|---|---|---|
| `APP__BASE_URL` | yes | Public origin of the app. `<base>/auth/callback` and `<base>/` must be registered on the ThunderID app as the redirect and post-logout URIs |
| `AUTH__BASE_URL` | yes | ThunderID base URL (discovery is at `/.well-known/openid-configuration`) |
| `AUTH__CLIENT_ID` | yes | `apex-consent-portal-client` |
| `AUTH__CLIENT_SECRET` | yes | `APEX_CONSENT_PORTAL_CLIENT_SECRET` from the ThunderID bundle |
| `AUTH__AUDIENCE` | yes | `urn:apex:consent-portal`, the application's default audience |
| `AUTH__SCOPES` | no | Defaults to `openid profile email portal:consents:read:self portal:consents:write:self` |
| `SESSION__SECRET` | yes | 32+ characters; encrypts the session cookie |
| `ASGARDEO__BASE_URL` | yes | `https://api.asgardeo.io/t/<org>` |
| `ASGARDEO__CLIENT_ID` / `ASGARDEO__CLIENT_SECRET` | yes | A machine-to-machine (M2M) app authorized for the Consent Management API v2 |
| `ASGARDEO__SCOPES` | no | Defaults to consent view and update, plus purpose view |
| `BANK_PORTAL__URL` | no | "Back to banking" in the account menu; hidden when unset |

## Running

```bash
npm install
npm run dev        # http://localhost:18060
npm test           # view-model rules
npm run lint && npm run typecheck && npm run build
```

To see data before the MCP server writes consents to Asgardeo, seed some with
`platform/consent/asgardeo/sample-consents.sh`.
