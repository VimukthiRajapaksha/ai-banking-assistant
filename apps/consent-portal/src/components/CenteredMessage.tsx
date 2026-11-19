'use client';

import NextLink from 'next/link';
import { Box, Button, CardContent, Stack, Typography } from '@wso2/oxygen-ui';
import { GlassCard } from './GlassCard';

/** A full-page message outside the signed-in shell: signed out, sign-in
 * failed, page not found. */
export function CenteredMessage({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; href: string };
}) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
      <GlassCard sx={{ maxWidth: 420, width: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          <Stack spacing={2} alignItems="center" sx={{ textAlign: 'center' }}>
            <Box component="img" src="/apex-logo.png" alt="Apex Bank" sx={{ width: 48, height: 48 }} />
            <Typography variant="h6" component="h1">
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {body}
            </Typography>
            {action && (
              <Button variant="contained" component={NextLink} href={action.href} prefetch={false}>
                {action.label}
              </Button>
            )}
          </Stack>
        </CardContent>
      </GlassCard>
    </Box>
  );
}
