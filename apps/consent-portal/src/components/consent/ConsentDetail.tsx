'use client';

import { useState } from 'react';
import NextLink from 'next/link';
import {
  Box,
  Button,
  CardContent,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@wso2/oxygen-ui';
import { AppWindow, ArrowLeft, Bot, Check, Copy, KeyRound, User } from '@wso2/oxygen-ui-icons-react';
import { formatMoney, type ConsentView, type TimelineEvent } from '@/lib/consent/model';
import { GlassCard } from '../GlassCard';
import { ConsentActions } from './ConsentActions';
import { KindIcon } from './KindIcon';
import { StatusChip } from './StatusChip';
import { DateTime, Relative, useNow } from './Time';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <GlassCard>
      <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
        <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: 1.5, letterSpacing: 1 }}>
          {title}
        </Typography>
        {children}
      </CardContent>
    </GlassCard>
  );
}

/** A label/value line. Values wrap rather than truncate: a payee name or a
 * reference cut off mid-word is worse than a taller card. */
function Row({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ py: 1 }}>
      {/* The icon sits inside the fixed-width label column, so values line
          up whether or not a row has one. */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ width: 140, flexShrink: 0, color: 'text.secondary' }}>
        {icon && <Box sx={{ display: 'flex' }}>{icon}</Box>}
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
      </Stack>
      <Typography variant="body2" component="div" sx={{ fontWeight: 500, minWidth: 0, overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </Stack>
  );
}

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <Typography variant="body2" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>
        {id}
      </Typography>
      <Tooltip title={copied ? 'Copied' : 'Copy reference'}>
        <IconButton
          size="small"
          aria-label="Copy reference"
          onClick={async () => {
            await navigator.clipboard.writeText(id);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <Check size={16} /> : <Copy size={16} />}
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

const TONE: Record<TimelineEvent['tone'], string> = {
  neutral: 'text.secondary',
  positive: 'success.main',
  negative: 'error.main',
};

function Timeline({ events }: { events: TimelineEvent[] }) {
  return (
    <Stack component="ol" sx={{ listStyle: 'none', m: 0, p: 0 }}>
      {events.map((event, i) => (
        <Stack component="li" key={event.label} direction="row" spacing={2} sx={{ position: 'relative', pb: i < events.length - 1 ? 2 : 0 }}>
          <Box sx={{ position: 'relative', width: 12, display: 'flex', justifyContent: 'center' }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: TONE[event.tone], mt: '6px', zIndex: 1 }} />
            {i < events.length - 1 && (
              <Box sx={{ position: 'absolute', top: 16, bottom: -8, width: '2px', bgcolor: 'divider' }} />
            )}
          </Box>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {event.label}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {event.at ? <DateTime value={event.at} /> : 'Time not recorded'}
            </Typography>
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

function Validity({ view }: { view: ConsentView }) {
  const now = useNow();
  const live = view.status === 'active' || view.status === 'pending';
  return (
    <>
      <Row label="Requested">
        <DateTime value={view.requestedAt} />
      </Row>
      {view.decidedAt && (
        <Row label={view.status === 'rejected' ? 'Rejected' : 'Approved'}>
          <DateTime value={view.decidedAt} />
        </Row>
      )}
      {live ? (
        <Row label={view.expiresAt && view.expiresAt <= now ? 'Ended' : 'Ends'}>
          {view.expiresAt ? (
            <>
              <DateTime value={view.expiresAt} />{' '}
              <Typography component="span" variant="body2" color="text.secondary">
                (<Relative value={view.expiresAt} />)
              </Typography>
            </>
          ) : (
            'When you revoke it'
          )}
        </Row>
      ) : (
        // Ended some other way: the planned end date is history, not a
        // countdown -- "ends in 58 minutes" on a revoked consent misleads.
        view.expiresAt && (
          <Row label="Was due to end">
            <DateTime value={view.expiresAt} />
          </Row>
        )
      )}
    </>
  );
}

const STATUS_NOTE: Partial<Record<ConsentView['status'], string>> = {
  pending: 'Waiting for your decision.',
  used: 'This payment was made. A payment consent works once, so it no longer grants anything.',
  replaced: 'A newer request for the same access took its place. You did not revoke this one.',
  expired: 'This consent reached its end date and no longer grants anything.',
  revoked: 'This consent was revoked and no longer grants anything.',
  rejected: 'You turned this request down.',
};

export function ConsentDetail({ view }: { view: ConsentView }) {
  const amount = view.payment ? formatMoney(view.payment.amount, view.payment.currency) : undefined;

  return (
    <Stack spacing={2.5}>
      <Box>
        <Button component={NextLink} href="/consents" startIcon={<ArrowLeft size={16} />} size="small">
          All consents
        </Button>
      </Box>

      {/* 1. What this is, in one sentence, and where it stands. */}
      <GlassCard>
        <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <KindIcon kind={view.kind} size={52} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="overline" color="text.secondary">
                {view.purpose.name}
              </Typography>
              <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
                {view.headline}
              </Typography>
              {STATUS_NOTE[view.status] && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {STATUS_NOTE[view.status]}
                </Typography>
              )}
            </Box>
            {/* Where it stands and what can be done about it, side by side. */}
            <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="flex-end" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <StatusChip status={view.status} size="medium" />
              <ConsentActions view={view} />
            </Stack>
          </Stack>
        </CardContent>
      </GlassCard>

      {/* 2. The payment itself -- the part the customer is approving. */}
      {view.payment && (
        <Section title="Payment">
          <Row label="Pay to">
            {view.payment.payee}
            {(view.payment.payeeAccountNumber || view.payment.payeeBank) && (
              <Typography variant="body2" color="text.secondary">
                {[view.payment.payeeAccountNumber, view.payment.payeeBank].filter(Boolean).join(' · ')}
              </Typography>
            )}
          </Row>
          {amount && <Row label="Amount">{amount}</Row>}
          {view.payment.reference && <Row label="Reference">{view.payment.reference}</Row>}
          <Row label="From">
            {view.payment.fromAccount ?? (view.status === 'pending' ? 'Chosen when you approve' : 'Not specified')}
          </Row>
          <Row label="Use">Single payment</Row>
          {view.payment.stepUp && (
            <Row label="Verified with" icon={<KeyRound size={16} />}>
              {view.payment.stepUp === 'passkey' ? 'Passkey' : view.payment.stepUp}
            </Row>
          )}
        </Section>
      )}

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        {/* 3. Who is involved. */}
        <Section title="Who">
          <Row label="App" icon={<AppWindow size={16} />}>
            {view.app.name}
          </Row>
          <Row label="Agent" icon={<Bot size={16} />}>
            {view.agent.name}
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
              Acts on your behalf
            </Typography>
          </Row>
          <Row label="You" icon={<User size={16} />}>
            {view.subject.name}
          </Row>
        </Section>

        {/* 4. How long it lasts. */}
        <Section title="Validity">
          <Validity view={view} />
        </Section>
      </Box>

      {/* 5. What it allows. */}
      <Section title={view.kind === 'payment' ? 'Permission' : 'Permissions'}>
        <Stack divider={<Divider flexItem />}>
          {view.permissions.map((p) => (
            <Box key={p.id} sx={{ py: 1.25 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {p.label}
              </Typography>
              {p.description && (
                <Typography variant="body2" color="text.secondary">
                  {p.description}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>
      </Section>

      <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
        {/* 6. What happened, in order. */}
        <Section title="Activity">
          <Timeline events={view.timeline} />
        </Section>

        {/* 7. What kind of consent this is, why the bank asks for it (when
            the purpose says), and a reference to quote to support. The
            purpose's version means nothing to a customer, so it is left out. */}
        <Section title="About this consent">
          <Row label="Type">{view.kind === 'payment' ? 'One-time payment' : view.kind === 'account' ? 'Access to your account information' : view.purpose.name}</Row>
          {view.purpose.description && <Row label="Why">{view.purpose.description}</Row>}
          <Row label="Reference">
            <CopyId id={view.id} />
          </Row>
        </Section>
      </Box>
    </Stack>
  );
}
