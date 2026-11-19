import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, unsealSession, type Session } from './session';

/** The signed-in customer, for server components and route handlers.
 *
 * The proxy has already turned away anyone without a session, so a miss here
 * means the cookie expired between the two -- sent back through sign-in.
 */
export async function currentSession(): Promise<Session | undefined> {
  return unsealSession((await cookies()).get(SESSION_COOKIE)?.value);
}

export async function requireSession(returnTo = '/'): Promise<Session> {
  const session = await currentSession();
  if (!session) {
    redirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  return session;
}
