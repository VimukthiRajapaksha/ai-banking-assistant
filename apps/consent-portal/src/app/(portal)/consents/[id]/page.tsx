import { notFound } from 'next/navigation';
import { requireSession } from '@/lib/auth/current';
import { loadView } from '@/lib/consent/load';
import { ConsentDetail } from '@/components/consent/ConsentDetail';

export const dynamic = 'force-dynamic';

export default async function ConsentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession(`/consents/${encodeURIComponent(id)}`);
  // Someone else's consent is "not found", never "forbidden" -- see getConsent.
  const view = await loadView(session.sub, id);
  if (!view) notFound();
  return <ConsentDetail view={view} />;
}
