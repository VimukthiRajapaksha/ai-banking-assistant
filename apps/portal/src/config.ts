/** Typed wrapper over the app's settings -- see .env.example for the full list.
 *
 * Each key is read from `window.configs` first, then from Vite's build-time
 * `import.meta.env`. `window.configs` comes from /config.js, which the WSO2
 * Developer Platform mounts per environment: it does not bake environment
 * variables into an SPA's build. Locally /config.js is an empty default
 * (public/config.js), so `.env` keeps working unchanged.
 */

declare global {
  interface Window {
    configs?: Record<string, string | undefined>;
  }
}

function read(key: string): string | undefined {
  return window.configs?.[key] || import.meta.env[key];
}

function required(key: string): string {
  const value = read(key);
  if (!value) {
    throw new Error(`Missing required setting: ${key}`);
  }
  return value;
}

export const config = {
  auth: {
    baseUrl: required('VITE_AUTH__BASE_URL'),
    clientId: required('VITE_AUTH__CLIENT_ID'),
    afterSignInUrl: required('VITE_AUTH__AFTER_SIGN_IN_URL'),
    // The path half of that URL. The app is put back on its real route once
    // the SDK has finished the exchange, so this is the one route that is
    // never a destination -- only a waypoint.
    callbackPath: new URL(required('VITE_AUTH__AFTER_SIGN_IN_URL')).pathname,
    afterSignOutUrl: required('VITE_AUTH__AFTER_SIGN_OUT_URL'),
    // The scope envelope requested at sign-in. A delegated token exchange can
    // narrow scopes but never widen them, so every scope any downstream hop
    // will need (agent, MCP server, bank) has to be granted here first.
    loginScopes: required('VITE_AUTH__LOGIN_SCOPES').split(' ').filter(Boolean),
    // ThunderID's end_session_endpoint. Hard-coded rather than read from the
    // SDK's resolved metadata because the sign-out path deliberately does not
    // go through the SDK at all -- see auth/signOut.ts.
    endSessionUrl: `${required('VITE_AUTH__BASE_URL')}/oauth2/logout`,
    // Resource indicator on the sign-in request. There is one resource server,
    // so this single value is the audience of the only token this app holds --
    // the one it calls both the bank and /chat with.
    audience: required('VITE_AUTH__AUDIENCE'),
  },
  /** Passkey setup, relayed by the agent -- it holds the ThunderID flow
   * secret, which cannot live in the browser, so this is a relay rather than a
   * direct call to the IdP. The agent's `/security/passkey` URL; the default
   * is same-origin, for a proxy that forwards that path to the agent. */
  security: {
    baseUrl: read('VITE_SECURITY__PASSKEY_URL') || '/security/passkey',
  },
  bankApi: {
    // Root of the bank's API; every resource is a path beneath it.
    baseUrl: required('VITE_BANK_API__BASE_URL'),
  },
  agent: {
    chatUrl: required('VITE_AGENT__CHAT_URL'),
  },
  /** A link only. This app never calls the consent API -- the MCP server owns
   * that -- but the customer needs somewhere to review and revoke what they
   * have granted, and that is the portal. Optional: without it the account
   * menu omits the item rather than offering a link that goes nowhere. */
  consentPortal: {
    url: read('VITE_CONSENT_PORTAL_URL'),
  },
};
