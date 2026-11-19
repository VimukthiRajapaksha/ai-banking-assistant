import { NextResponse, type NextRequest } from 'next/server';
import { authorizationUrl, client } from '@/lib/auth/oidc';
import { safeReturnTo } from '@/lib/auth/returnTo';
import { config } from '@/lib/config';
import { sealTransaction, sessionCookieOptions, TRANSACTION_COOKIE, TRANSACTION_MAX_AGE } from '@/lib/auth/session';

/** Starts sign-in. The customer arrives from the bank portal already signed in
 * to ThunderID through the same flow, so this round trip normally completes
 * without a prompt. */
export async function GET(request: NextRequest) {
  const state = client.randomState();
  const codeVerifier = client.randomPKCECodeVerifier();
  const returnTo = safeReturnTo(request.nextUrl.searchParams.get('returnTo'));

  let target: URL;
  try {
    target = await authorizationUrl(state, codeVerifier);
  } catch (error) {
    // ThunderID unreachable (discovery failed). Say so, rather than a 500.
    console.error('sign-in unavailable:', error instanceof Error ? error.message : error);
    return NextResponse.redirect(config.appUrl('/signed-out?error=idp_unavailable'));
  }

  const response = NextResponse.redirect(target);
  response.cookies.set(TRANSACTION_COOKIE, await sealTransaction({ state, codeVerifier, returnTo }), {
    ...sessionCookieOptions,
    maxAge: TRANSACTION_MAX_AGE,
  });
  return response;
}
