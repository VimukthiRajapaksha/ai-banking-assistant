import { Card, styled } from '@wso2/oxygen-ui';

/** The mockup's `.glass-card` effect (blur + translucency), as a themed MUI
 * Card -- the blur itself is not an M3 token, but every colour in it comes
 * from the palette so the effect restyles with the rest of the app. */
export const GlassCard = styled(Card)(({ theme }) => ({
  // theme.vars, not theme.palette: the CSS variables follow the colour
  // scheme, the plain palette is always the light one.
  background: (theme.vars ?? theme).palette.glass.fill,
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  border: `1px solid ${(theme.vars ?? theme).palette.glass.border}`,
  boxShadow: (theme.vars ?? theme).palette.glass.shadow,
  borderRadius: theme.shape.borderRadius,
  transition: 'transform 0.2s ease',
}));
