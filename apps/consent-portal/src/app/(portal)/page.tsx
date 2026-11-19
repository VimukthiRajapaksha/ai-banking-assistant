import { requireSession } from '@/lib/auth/current';
import { loadViews } from '@/lib/consent/load';
import { Dashboard } from '@/components/consent/Dashboard';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const session = await requireSession('/');
  return <Dashboard views={await loadViews(session.sub)} name={session.name} />;
}
