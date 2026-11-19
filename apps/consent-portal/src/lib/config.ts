import 'server-only';

/** Typed wrapper over the server's settings -- see .env.example for the list.
 *
 * Read from process.env at run time, never baked into the build: none of these
 * reaches the browser, and one image serves every environment. Read lazily, so
 * `next build` does not need a populated environment.
 */

function required(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required setting: ${key}`);
  }
  return value;
}

const trim = (url: string) => url.replace(/\/+$/, '');

export const config = {
  /** The portal's public root, including any path prefix it is served under. */
  get appBaseUrl() {
    return trim(required('APP__BASE_URL'));
  },
  /** An absolute URL for an app path such as `/signed-out`. `new URL(path, base)`
   * would drop the base's own path prefix. */
  appUrl(path: string) {
    return new URL(`${config.appBaseUrl}${path}`);
  },
  auth: {
    get baseUrl() {
      return trim(required('AUTH__BASE_URL'));
    },
    get clientId() {
      return required('AUTH__CLIENT_ID');
    },
    get clientSecret() {
      return required('AUTH__CLIENT_SECRET');
    },
    get audience() {
      return required('AUTH__AUDIENCE');
    },
    get scopes() {
      return process.env.AUTH__SCOPES || 'openid profile email portal:consents:read:self portal:consents:write:self';
    },
    get redirectUri() {
      return `${config.appBaseUrl}/auth/callback`;
    },
    get postLogoutRedirectUri() {
      return `${config.appBaseUrl}/`;
    },
  },
  get sessionSecret() {
    const secret = required('SESSION__SECRET');
    if (secret.length < 32) {
      throw new Error('SESSION__SECRET must be at least 32 characters');
    }
    return secret;
  },
  asgardeo: {
    get baseUrl() {
      return trim(required('ASGARDEO__BASE_URL'));
    },
    get clientId() {
      return required('ASGARDEO__CLIENT_ID');
    },
    get clientSecret() {
      return required('ASGARDEO__CLIENT_SECRET');
    },
    get scopes() {
      return (
        process.env.ASGARDEO__SCOPES ||
        'internal_consent_mgt_consent_view internal_consent_mgt_consent_update internal_consent_mgt_purpose_view'
      );
    },
  },
  /** Optional: without it the "Back to banking" link is hidden rather than
   * pointing nowhere. */
  get bankPortalUrl() {
    return process.env.BANK_PORTAL__URL || undefined;
  },
};

/** Scopes the customer's token must carry, per kind of operation. */
export const SCOPE_READ = 'portal:consents:read:self';
export const SCOPE_WRITE = 'portal:consents:write:self';
