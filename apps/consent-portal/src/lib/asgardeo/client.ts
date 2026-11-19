import 'server-only';
import { config } from '../config';

/** Asgardeo's Consent Management API v2, called with this app's own client
 * credentials.
 *
 * Those credentials can read every consent in the organization, which is why
 * they live only on this server and why every caller above this file scopes
 * its query to the signed-in customer.
 */

interface CachedToken {
  value: string;
  expiresAt: number;
}

/** Renewed this long before expiry, so a request never sets out with a token
 * that lapses in flight. */
const RENEW_MARGIN_MS = 60_000;

let cached: CachedToken | undefined;
let inflight: Promise<CachedToken> | undefined;

async function fetchToken(): Promise<CachedToken> {
  const { baseUrl, clientId, clientSecret, scopes } = config.asgardeo;
  const response = await fetch(`${baseUrl}/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: scopes }),
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new AsgardeoError(response.status, 'token_failed', `Asgardeo token request failed (${response.status})`);
  }
  const body = (await response.json()) as { access_token: string; expires_in?: number };
  return { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
}

/** The client-credentials grant has no refresh token: "refreshing" is asking
 * again. Concurrent callers share one request rather than each minting a
 * token. */
async function token(force = false): Promise<string> {
  if (!force && cached && cached.expiresAt - Date.now() > RENEW_MARGIN_MS) {
    return cached.value;
  }
  inflight ??= fetchToken().finally(() => {
    inflight = undefined;
  });
  cached = await inflight;
  return cached.value;
}

export class AsgardeoError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const apiRoot = () => `${config.asgardeo.baseUrl}/api/identity/consent-mgt/v2.0`;

/** One call to the API. `path` is relative to the API root, or an absolute
 * URL -- the cursor links Asgardeo returns are absolute. */
export async function asgardeo<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = path.startsWith('https://') ? path : `${apiRoot()}${path}`;
  if (!url.startsWith(apiRoot())) {
    // A pagination link is followed verbatim; make sure it still points at
    // the consent API before a bearer token is sent to it.
    throw new AsgardeoError(400, 'bad_link', 'Refusing to follow a link outside the consent API');
  }

  const send = async (bearer: string) =>
    fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
    });

  let response = await send(await token());
  if (response.status === 401) {
    // Revoked or rotated server-side before its expiry: one fresh attempt.
    response = await send(await token(true));
  }

  if (!response.ok) {
    let detail: { code?: string; description?: string; message?: string } = {};
    try {
      detail = await response.json();
    } catch {
      // Not JSON; the status says enough.
    }
    // Logged with Asgardeo's own words; the caller gets a stable shape and
    // the browser never sees the upstream trace id.
    console.error(`asgardeo ${method} ${path} -> ${response.status}`, detail.code, detail.description ?? detail.message);
    throw new AsgardeoError(response.status, detail.code ?? 'upstream_error', detail.description ?? detail.message ?? 'Consent service error');
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
