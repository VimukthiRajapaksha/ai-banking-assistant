'use client';

import { CardContent, Stack, Typography } from '@wso2/oxygen-ui';
import { Inbox } from '@wso2/oxygen-ui-icons-react';
import { GlassCard } from '../GlassCard';

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <GlassCard>
      <CardContent>
        <Stack alignItems="center" spacing={1} sx={{ py: 4, textAlign: 'center' }}>
          <Inbox size={32} aria-hidden />
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420 }}>
            {body}
          </Typography>
        </Stack>
      </CardContent>
    </GlassCard>
  );
}
