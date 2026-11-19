import { NextResponse, type NextRequest } from 'next/server';
import { completeSignIn, describe } from '@/lib/auth/oidc';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  TRANSACTION_COOKIE,
  sealSession,
  sessionCookieOptions,
  unsealTransaction,
} from '@/lib/auth/session';
import { config } from '@/lib/config';

/** Where ThunderID returns with the code. Registered on the application as
 * <APP__BASE_URL>/auth/callback. */
export async function GET(request: NextRequest) {
  const tx = await unsealTransaction(request.cookies.get(TRANSACTION_COOKIE)?.value);
  const fail = (reason: string) => {
    const url = new URL('/signed-out', config.appBaseUrl);
    url.searchParams.set('error', reason);
    const response = NextResponse.redirect(url);
    response.cookies.delete(TRANSACTION_COOKIE);
    return response;
  };

  // An IdP-reported error (the customer cancelled, the app is misconfigured)
  // is shown as such, not retried: retrying would loop.
  const idpError = request.nextUrl.searchParams.get('error');
  if (idpError) return fail(idpError);
  if (!tx) return fail('sign_in_expired');

  try {
    // The URL ThunderID called, rebuilt on the public origin: behind a proxy
    // request.url carries the internal host, and the token request must name
    // the redirect_uri exactly as it was registered.
    const callbackUrl = new URL(`${config.auth.redirectUri}${request.nextUrl.search}`);
    const session = await completeSignIn(callbackUrl, tx.state, tx.codeVerifier);
    const response = NextResponse.redirect(new URL(tx.returnTo, config.appBaseUrl));
    response.cookies.set(SESSION_COOKIE, await sealSession(session), {
      ...sessionCookieOptions,
      maxAge: SESSION_MAX_AGE,
    });
    response.cookies.delete(TRANSACTION_COOKIE);
    return response;
  } catch (error) {
    console.error('sign-in failed:', describe(error));
    return fail('sign_in_failed');
  }
}
