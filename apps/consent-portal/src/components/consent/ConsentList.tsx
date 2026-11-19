'use client';

import NextLink from 'next/link';
import { Box, Pagination, PaginationItem, Stack, Tab, Tabs, ToggleButton, ToggleButtonGroup, Typography } from '@wso2/oxygen-ui';
import type { ConsentView } from '@/lib/consent/model';
import { ConsentRow } from './ConsentRow';
import { EmptyState } from './EmptyState';

export type StatusFilter = 'all' | 'pending' | 'active' | 'ended';
export type KindFilter = 'all' | 'account' | 'payment';

const TABS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Waiting for you' },
  { value: 'active', label: 'Active' },
  { value: 'ended', label: 'Ended' },
];

function href(status: StatusFilter, kind: KindFilter, page = 1) {
  const params = new URLSearchParams();
  if (status !== 'all') params.set('status', status);
  if (kind !== 'all') params.set('type', kind);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/consents?${query}` : '/consents';
}

/** Every consent, filtered by where it stands and what it is for. Filters
 * live in the URL, so a filtered view can be bookmarked and survives a
 * refresh. */
export function ConsentList({
  views,
  status,
  kind,
  page,
  pageCount,
  counts,
}: {
  views: ConsentView[];
  status: StatusFilter;
  kind: KindFilter;
  page: number;
  pageCount: number;
  counts: Record<StatusFilter, number>;
}) {
  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          Consents
        </Typography>
        <Typography color="text.secondary">Review what you have allowed, and take it back at any time.</Typography>
      </Box>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ sm: 'center' }}>
        <Tabs value={status} variant="scrollable" allowScrollButtonsMobile aria-label="Filter by status">
          {TABS.map((tab) => (
            <Tab
              key={tab.value}
              value={tab.value}
              label={`${tab.label} (${counts[tab.value]})`}
              component={NextLink}
              href={href(tab.value, kind)}
            />
          ))}
        </Tabs>
        <ToggleButtonGroup size="small" value={kind} exclusive aria-label="Filter by type">
          <ToggleButton value="all" component={NextLink} href={href(status, 'all')}>
            All types
          </ToggleButton>
          <ToggleButton value="account" component={NextLink} href={href(status, 'account')}>
            Account access
          </ToggleButton>
          <ToggleButton value="payment" component={NextLink} href={href(status, 'payment')}>
            Payments
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {views.length === 0 ? (
        <EmptyState title="Nothing here" body="No consents match this filter." />
      ) : (
        <Stack spacing={1.5}>
          {views.map((view) => (
            <ConsentRow key={view.id} view={view} />
          ))}
        </Stack>
      )}

      {pageCount > 1 && (
        // Each page is a link, so the page number lives in the URL with the
        // filters: bookmarkable, and the back button steps through pages.
        <Stack alignItems="center" sx={{ pb: 4 }}>
          <Pagination
            page={page}
            count={pageCount}
            color="primary"
            shape="rounded"
            aria-label="Consent pages"
            renderItem={(item) => (
              <PaginationItem component={NextLink} href={href(status, kind, item.page ?? 1)} {...item} />
            )}
          />
        </Stack>
      )}
    </Stack>
  );
}
