'use client';

import { Avatar } from '@wso2/oxygen-ui';
import { Landmark, Send, ShieldCheck } from '@wso2/oxygen-ui-icons-react';
import type { Kind } from '@/lib/consent/model';

/** The consent's kind at a glance: account access or a payment. */
export function KindIcon({ kind, size = 40 }: { kind: Kind; size?: number }) {
  const icon = kind === 'payment' ? <Send size={size / 2} /> : kind === 'account' ? <Landmark size={size / 2} /> : <ShieldCheck size={size / 2} />;
  return (
    <Avatar
      variant="rounded"
      sx={{
        width: size,
        height: size,
        bgcolor: kind === 'payment' ? 'tertiary.fixed' : 'surface.high',
        color: kind === 'payment' ? 'tertiary.main' : 'primary.main',
      }}
    >
      {icon}
    </Avatar>
  );
}
