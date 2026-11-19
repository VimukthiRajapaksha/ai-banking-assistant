import { NextResponse } from 'next/server';
import { endSessionUrl } from '@/lib/auth/oidc';
import { SESSION_COOKIE } from '@/lib/auth/session';

/** Ends the session here and at ThunderID. ThunderID's session is the one the
 * bank portal signed in with too, so this signs the customer out of both --
 * which is what "Sign out" on a shared machine has to mean.
 *
 * POST, so a cross-site link or image cannot sign someone out. */
export async function POST() {
  const response = NextResponse.redirect(await endSessionUrl(), 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
