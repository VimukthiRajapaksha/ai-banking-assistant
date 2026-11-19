import { requireSession } from '@/lib/auth/current';
import { loadViews } from '@/lib/consent/load';
import { ENDED, type ConsentView } from '@/lib/consent/model';
import { ConsentList, type KindFilter, type StatusFilter } from '@/components/consent/ConsentList';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 10;

const STATUS_MATCH: Record<StatusFilter, (v: ConsentView) => boolean> = {
  all: () => true,
  pending: (v) => v.status === 'pending',
  active: (v) => v.status === 'active',
  ended: (v) => ENDED.includes(v.status),
};

const pick = <T extends string>(value: string | string[] | undefined, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;

export default async function ConsentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = pick(params.status, ['all', 'pending', 'active', 'ended'] as const, 'all');
  const kind = pick(params.type, ['all', 'account', 'payment'] as const, 'all');

  const session = await requireSession('/consents');
  const views = (await loadViews(session.sub)).filter((v) => kind === 'all' || v.kind === kind);

  const counts = Object.fromEntries(
    (Object.keys(STATUS_MATCH) as StatusFilter[]).map((s) => [s, views.filter(STATUS_MATCH[s]).length]),
  ) as Record<StatusFilter, number>;

  const matching = views.filter(STATUS_MATCH[status]);
  const pageCount = Math.max(1, Math.ceil(matching.length / PAGE_SIZE));
  const page = Math.min(pageCount, Math.max(1, Number(params.page) || 1));

  return (
    <ConsentList
      views={matching.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)}
      status={status}
      kind={kind as KindFilter}
      page={page}
      pageCount={pageCount}
      counts={counts}
    />
  );
}
