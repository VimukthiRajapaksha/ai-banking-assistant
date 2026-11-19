'use client';

import { Card, styled } from '@wso2/oxygen-ui';

/** The bank portal's frosted-glass card (apps/portal/src/components/glass),
 * so a consent sits on the same surface as the account it concerns. */
export const GlassCard = styled(Card)(({ theme }) => ({
  // theme.vars, not theme.palette: the CSS variables follow the colour
  // scheme, the plain palette is always the light one.
  background: (theme.vars ?? theme).palette.glass.fill,
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: `1px solid ${(theme.vars ?? theme).palette.glass.border}`,
  boxShadow: (theme.vars ?? theme).palette.glass.shadow,
  borderRadius: theme.shape.borderRadius,
}));
