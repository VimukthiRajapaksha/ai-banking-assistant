'use client';

import { Alert, Button, Stack } from '@wso2/oxygen-ui';

/** The consent service failed while loading a page. Says so plainly and
 * offers a retry -- no stack traces, no upstream error codes. */
export default function PortalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <Stack spacing={2} sx={{ maxWidth: 640, mx: 'auto', mt: 4 }}>
      <Alert severity="error">We could not load your consents just now. This is on our side, not yours.</Alert>
      <Button variant="contained" onClick={reset} sx={{ alignSelf: 'flex-start' }}>
        Try again
      </Button>
    </Stack>
  );
}
