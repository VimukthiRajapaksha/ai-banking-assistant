'use client';

import NextLink from 'next/link';
import { Box, CardActionArea, Chip, Stack, Typography } from '@wso2/oxygen-ui';
import { ChevronRight } from '@wso2/oxygen-ui-icons-react';
import type { ConsentView } from '@/lib/consent/model';
import { GlassCard } from '../GlassCard';
import { KindIcon } from './KindIcon';
import { StatusChip } from './StatusChip';
import { Relative, useNow } from './Time';

/** One consent in a list: what it is, who asked, and how long it lasts. */
export function ConsentRow({ view }: { view: ConsentView }) {
  const now = useNow();
  const live = view.status === 'active' || view.status === 'pending';
  return (
    <GlassCard>
      <CardActionArea component={NextLink} href={`/consents/${view.id}`} sx={{ p: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <KindIcon kind={view.kind} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>
                {view.headline}
              </Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" noWrap>
              {view.app.name} · {view.agent.name}
            </Typography>
            <Stack direction="row" spacing={0.75} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 0.75 }}>
              {view.kind === 'payment'
                ? view.payment?.reference && <Chip size="small" variant="outlined" label={view.payment.reference} />
                : view.permissions.map((p) => <Chip key={p.id} size="small" variant="outlined" label={p.label} />)}
            </Stack>
          </Box>
          <Stack alignItems="flex-end" spacing={0.75} sx={{ flexShrink: 0 }}>
            <StatusChip status={view.status} />
            <Typography variant="caption" color="text.secondary">
              {live && view.expiresAt ? (
                <>
                  {view.expiresAt > now ? 'Ends ' : 'Ended '}
                  <Relative value={view.expiresAt} />
                </>
              ) : (
                <>
                  Requested <Relative value={view.requestedAt} />
                </>
              )}
            </Typography>
          </Stack>
          <ChevronRight size={18} aria-hidden />
        </Stack>
      </CardActionArea>
    </GlassCard>
  );
}
