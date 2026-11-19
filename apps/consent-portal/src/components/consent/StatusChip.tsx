'use client';

import { Chip } from '@wso2/oxygen-ui';
import type { Status } from '@/lib/consent/model';

const LABEL: Record<Status, string> = {
  pending: 'Pending',
  active: 'Active',
  rejected: 'Rejected',
  revoked: 'Revoked',
  used: 'Used',
  replaced: 'Replaced',
  expired: 'Expired',
};

const COLOR: Record<Status, 'warning' | 'success' | 'error' | 'default'> = {
  pending: 'warning',
  active: 'success',
  rejected: 'error',
  revoked: 'error',
  used: 'success',
  replaced: 'default',
  expired: 'default',
};

export function StatusChip({ status, size = 'small' }: { status: Status; size?: 'small' | 'medium' }) {
  return <Chip label={LABEL[status]} color={COLOR[status]} size={size} variant={status === 'active' || status === 'pending' ? 'filled' : 'outlined'} />;
}

export const statusLabel = (status: Status) => LABEL[status];
