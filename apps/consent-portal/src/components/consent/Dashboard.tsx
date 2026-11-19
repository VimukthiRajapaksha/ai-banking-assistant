'use client';

import NextLink from 'next/link';
import { Box, Button, Stack, StatCard, Typography } from '@wso2/oxygen-ui';
import { Clock3, Hourglass, ShieldCheck } from '@wso2/oxygen-ui-icons-react';
import { isExpiringWithin, type ConsentView } from '@/lib/consent/model';
import { ConsentRow } from './ConsentRow';
import { EmptyState } from './EmptyState';
import { useNow } from './Time';

const DAY_MS = 24 * 60 * 60 * 1000;

function Group({ title, action, views }: { title: string; action?: React.ReactNode; views: ConsentView[] }) {
  if (!views.length) return null;
  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
        <Typography variant="h6" component="h2">
          {title}
        </Typography>
        {action}
      </Stack>
      <Stack spacing={1.5}>
        {views.map((view) => (
          <ConsentRow key={view.id} view={view} />
        ))}
      </Stack>
    </Box>
  );
}

/** What needs the customer now, then what is live, then what just changed. */
export function Dashboard({ views, name }: { views: ConsentView[]; name?: string }) {
  const now = useNow();
  const pending = views.filter((v) => v.status === 'pending');
  const active = views.filter((v) => v.status === 'active');
  const expiring = views.filter((v) => isExpiringWithin(v, DAY_MS, now));
  const recent = views.filter((v) => v.status !== 'pending' && v.status !== 'active').slice(0, 5);

  return (
    <Stack spacing={4}>
      <Box>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 600 }}>
          {name ? `Hi ${name.split(' ')[0]}` : 'Your consents'}
        </Typography>
        <Typography color="text.secondary">
          What you have allowed assistants and apps to do on your behalf.
        </Typography>
      </Box>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } }}>
        <StatCard value={pending.length} label="Waiting for you" icon={<Clock3 size={20} />} iconColor="warning" />
        <StatCard value={active.length} label="Active now" icon={<ShieldCheck size={20} />} iconColor="success" />
        <StatCard value={expiring.length} label="Ending within 24 hours" icon={<Hourglass size={20} />} iconColor="info" />
      </Box>

      {views.length === 0 ? (
        <EmptyState
          title="No consents yet"
          body="When the assistant asks for access to your accounts or to make a payment, the request appears here."
        />
      ) : (
        <>
          <Group title="Waiting for you" views={pending} />
          <Group
            title="Active now"
            views={active}
            action={
              <Button component={NextLink} href="/consents?status=active" size="small">
                View all
              </Button>
            }
          />
          <Group
            title="Recently ended"
            views={recent}
            action={
              <Button component={NextLink} href="/consents?status=ended" size="small">
                View all
              </Button>
            }
          />
        </>
      )}
    </Stack>
  );
}
