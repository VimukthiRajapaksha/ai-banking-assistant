import { NextResponse, type NextRequest } from 'next/server';
import { describe, refresh } from '@/lib/auth/oidc';
import { SESSION_COOKIE, SESSION_MAX_AGE, sealSession, sessionCookieOptions, unsealSession } from '@/lib/auth/session';

/** Every page and API call passes through here first.
 *
 * - No session: a page goes to sign-in (silent, with the bank portal's
 *   ThunderID session); an API call gets 401, since a redirect is meaningless
 *   to fetch().
 * - Session about to expire: refreshed here, because this is the one place
 *   that can both write the new cookie and hand it to the page being rendered
 *   -- server components can read cookies but not set them.
 */

const REFRESH_MARGIN_MS = 60_000;

function unauthenticated(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ code: 'unauthenticated', message: 'Sign in again to continue.' }, { status: 401 });
  }
  // From nextUrl, which carries the base path: a URL built from request.url
  // would lose it.
  const login = request.nextUrl.clone();
  login.pathname = '/auth/login';
  login.search = '';
  login.searchParams.set('returnTo', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = NextResponse.redirect(login);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

export async function proxy(request: NextRequest) {
  const session = await unsealSession(request.cookies.get(SESSION_COOKIE)?.value);
  if (!session) return unauthenticated(request);
  if (session.expiresAt - Date.now() > REFRESH_MARGIN_MS) return NextResponse.next();

  try {
    const sealed = await sealSession(await refresh(session));
    // The page rendered by this request reads the cookie from the request,
    // so the new value goes there as well as onto the response.
    request.cookies.set(SESSION_COOKIE, sealed);
    const response = NextResponse.next({ request: { headers: request.headers } });
    response.cookies.set(SESSION_COOKIE, sealed, { ...sessionCookieOptions, maxAge: SESSION_MAX_AGE });
    return response;
  } catch (error) {
    // A refresh token ThunderID no longer honours. Signing in again is silent
    // while the ThunderID session lasts, so this costs the customer nothing.
    console.warn('session refresh failed:', describe(error));
    return unauthenticated(request);
  }
}

export const config = {
  // Everything except sign-in itself, the signed-out page, the health check,
  // and static files. '/' is listed on its own: under a base path the bare
  // prefix is not matched by the pattern.
  matcher: ['/', '/((?!auth/|signed-out|api/health|_next/|apex-logo\\.png|favicon\\.ico).*)'],
};
