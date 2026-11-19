import 'server-only';
import { sealData, unsealData } from 'iron-session';
import { config } from '../config';

/** What this app remembers about a signed-in customer, in an encrypted,
 * httpOnly cookie. Tokens never reach the browser's JavaScript.
 *
 * Only what is used is kept. The access token is verified at sign-in and on
 * every refresh, and its subject, scopes and expiry are kept -- but not the
 * token itself: this app never sends it anywhere, and ThunderID's tokens are
 * large enough (about 2 KB) that carrying one put the cookie at 3.9 KB, a
 * refresh away from the 4 KB limit. The ID token is likewise read for the
 * customer's name and dropped; sign-out does not need it (see auth/logout).
 */
export interface Session {
  /** ThunderID subject: the customer's user id, and the `subjectId` of every
   * consent written for them. */
  sub: string;
  name?: string;
  email?: string;
  scopes: string[];
  refreshToken?: string;
  /** Epoch ms: when the access token behind this session expires, and so when
   * ThunderID is next asked (by refreshing) whether the session still holds. */
  expiresAt: number;
}

/** In flight between /auth/login and /auth/callback only. */
export interface SignInTransaction {
  state: string;
  codeVerifier: string;
  returnTo: string;
}

export const SESSION_COOKIE = 'cp_session';
export const TRANSACTION_COOKIE = 'cp_signin';

const SESSION_TTL_SECONDS = 8 * 60 * 60;
const TRANSACTION_TTL_SECONDS = 10 * 60;

export const sessionCookieOptions = {
  httpOnly: true,
  // Lax, not strict: the callback is a top-level redirect from ThunderID, and
  // strict would withhold the sign-in transaction cookie on exactly that hop.
  // Lax still withholds it from cross-site POSTs, which is what CSRF needs.
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};

/** Browsers drop a cookie over 4096 bytes without an error -- the customer
 * would simply bounce back to sign-in forever. Refuse loudly instead. */
const COOKIE_LIMIT = 4000;

export async function sealSession(session: Session): Promise<string> {
  const sealed = await sealData(session, { password: config.sessionSecret, ttl: SESSION_TTL_SECONDS });
  if (sealed.length > COOKIE_LIMIT) {
    throw new Error(`session cookie is ${sealed.length} bytes, over the ${COOKIE_LIMIT}-byte limit`);
  }
  return sealed;
}

export const sealTransaction = (tx: SignInTransaction) =>
  sealData(tx, { password: config.sessionSecret, ttl: TRANSACTION_TTL_SECONDS });

/** Undefined for a missing, tampered or expired cookie -- all three mean
 * "not signed in", and none is worth distinguishing to the caller. */
export async function unsealSession(value: string | undefined): Promise<Session | undefined> {
  if (!value) return undefined;
  try {
    const session = await unsealData<Session>(value, { password: config.sessionSecret, ttl: SESSION_TTL_SECONDS });
    return session?.sub && session.expiresAt ? session : undefined;
  } catch {
    return undefined;
  }
}

export async function unsealTransaction(value: string | undefined): Promise<SignInTransaction | undefined> {
  if (!value) return undefined;
  try {
    const tx = await unsealData<SignInTransaction>(value, {
      password: config.sessionSecret,
      ttl: TRANSACTION_TTL_SECONDS,
    });
    return tx?.state && tx.codeVerifier ? tx : undefined;
  } catch {
    return undefined;
  }
}

export const SESSION_MAX_AGE = SESSION_TTL_SECONDS;
export const TRANSACTION_MAX_AGE = TRANSACTION_TTL_SECONDS;
