import { requireSession } from '@/lib/auth/current';
import { config, SCOPE_READ } from '@/lib/config';
import { PortalShell } from '@/components/layout/PortalShell';
import { NoAccess } from '@/components/NoAccess';

/** Every signed-in page: the session is required here, and the shell gets the
 * customer's name -- nothing else from the session reaches the browser. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const user = { name: session.name, email: session.email };

  // No Suspense boundary here: every page under it is dynamic, and a
  // boundary would start streaming before a page can call notFound(),
  // turning a missing consent into a 200.
  return (
    <PortalShell user={user} bankPortalUrl={config.bankPortalUrl}>
      {session.scopes.includes(SCOPE_READ) ? children : <NoAccess />}
    </PortalShell>
  );
}
