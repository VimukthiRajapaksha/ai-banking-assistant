import 'server-only';
import * as client from 'openid-client';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { config } from '../config';
import type { Session } from './session';

/** OpenID Connect against ThunderID, as a confidential client.
 *
 * Authorization code + PKCE. No `nonce` is sent: ThunderID does not echo it
 * back in the ID token, and a nonce that is sent but never returned fails
 * validation -- the bank portal turns the check off for the same reason. PKCE
 * and `state` already bind the code to this browser.
 */

let discovered: Promise<client.Configuration> | undefined;

export function oidcConfig(): Promise<client.Configuration> {
  discovered ??= client
    .discovery(
      new URL(config.auth.baseUrl),
      config.auth.clientId,
      undefined,
      // The application is registered with tokenEndpointAuthMethod
      // client_secret_basic; openid-client would otherwise post the secret
      // in the body, which ThunderID rejects for this client.
      client.ClientSecretBasic(config.auth.clientSecret),
    )
    .catch((error) => {
      // Not cached: a ThunderID outage at start-up must not wedge the app
      // until it is restarted.
      discovered = undefined;
      throw error;
    });
  return discovered;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

/** The access token is what proves who the customer is, so it is verified
 * here -- signature, issuer, audience, expiry -- before anything is read from
 * it. The ID token is only a source of display names. */
async function verifyAccessToken(accessToken: string) {
  const oidc = await oidcConfig();
  const metadata = oidc.serverMetadata();
  jwks ??= createRemoteJWKSet(new URL(metadata.jwks_uri!));
  const { payload } = await jwtVerify(accessToken, jwks, {
    issuer: metadata.issuer,
    audience: config.auth.audience,
    clockTolerance: 30,
  });
  if (!payload.sub) {
    throw new Error('access token has no subject');
  }
  return payload;
}

function scopesOf(payload: Record<string, unknown>, granted?: string): string[] {
  const claim = payload.scope ?? granted ?? '';
  return (Array.isArray(claim) ? claim : String(claim).split(' ')).filter(Boolean);
}

/** Display names from the ID token, if one came back. Never trusted for
 * identity -- `sub` comes from the verified access token. */
function profileOf(idToken: string | undefined): Pick<Session, 'name' | 'email'> {
  if (!idToken) return {};
  try {
    const claims = decodeJwt(idToken);
    const given = typeof claims.given_name === 'string' ? claims.given_name : '';
    const family = typeof claims.family_name === 'string' ? claims.family_name : '';
    const name = `${given} ${family}`.trim() || (typeof claims.username === 'string' ? claims.username : undefined);
    return { name, email: typeof claims.email === 'string' ? claims.email : undefined };
  } catch {
    return {};
  }
}

async function toSession(tokens: client.TokenEndpointResponse, previous?: Session): Promise<Session> {
  const payload = await verifyAccessToken(tokens.access_token);
  const profile = profileOf(tokens.id_token);
  if (previous && previous.sub !== payload.sub) {
    // A refresh that comes back for someone else is not a refresh.
    throw new Error('refreshed token belongs to a different subject');
  }
  const expiresIn = tokens.expires_in ?? (payload.exp ? payload.exp - Math.floor(Date.now() / 1000) : 300);
  return {
    sub: payload.sub!,
    name: profile.name ?? previous?.name,
    email: profile.email ?? previous?.email,
    scopes: scopesOf(payload, tokens.scope),
    // ThunderID may or may not rotate it; keep the old one if not.
    refreshToken: tokens.refresh_token ?? previous?.refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
}

export async function authorizationUrl(state: string, codeVerifier: string): Promise<URL> {
  const oidc = await oidcConfig();
  return client.buildAuthorizationUrl(oidc, {
    redirect_uri: config.auth.redirectUri,
    scope: config.auth.scopes,
    state,
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
  });
}

export async function completeSignIn(callbackUrl: URL, expectedState: string, codeVerifier: string) {
  const oidc = await oidcConfig();
  const tokens = await client.authorizationCodeGrant(oidc, callbackUrl, {
    expectedState,
    pkceCodeVerifier: codeVerifier,
    idTokenExpected: false,
  });
  return toSession(tokens);
}

export async function refresh(session: Session): Promise<Session> {
  if (!session.refreshToken) {
    throw new Error('no refresh token');
  }
  const oidc = await oidcConfig();
  const tokens = await client.refreshTokenGrant(oidc, session.refreshToken);
  return toSession(tokens, session);
}

/** RP-initiated logout with `client_id` rather than `id_token_hint` -- the
 * ID token is not kept (see Session), and ThunderID accepts either. */
export async function endSessionUrl(): Promise<string> {
  const oidc = await oidcConfig();
  const endpoint = oidc.serverMetadata().end_session_endpoint ?? `${config.auth.baseUrl}/oauth2/logout`;
  const params = new URLSearchParams({
    client_id: config.auth.clientId,
    post_logout_redirect_uri: config.auth.postLogoutRedirectUri,
  });
  return `${endpoint}?${params.toString()}`;
}

/** An OIDC failure, described for the log: openid-client's own message is
 * generic ("server responded with an error"), the IdP's `error` and
 * `error_description` are what say why. */
export function describe(error: unknown): string {
  if (error instanceof client.ResponseBodyError) {
    return `${error.error}${error.error_description ? `: ${error.error_description}` : ''} (HTTP ${error.status})`;
  }
  return error instanceof Error ? error.message : String(error);
}

export { client };
