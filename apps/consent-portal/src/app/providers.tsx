'use client';

import { useSyncExternalStore } from 'react';
import { CssBaseline, OxygenUIThemeProvider } from '@wso2/oxygen-ui';
import { theme } from '@/theme/theme';

const noop = () => () => {};

/** The theme, rendered in the browser only.
 *
 * Oxygen UI's provider creates its own Emotion cache, which Next's style
 * registry cannot collect on the server: server-rendered markup then carries
 * inline <style> tags the client never produces, and React rejects the
 * hydration. The bank portal is a client-only SPA for the same reason. The
 * server still decides everything that matters -- the session, the data, the
 * 404 -- before this renders; only the painting waits for the browser.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  const mounted = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  if (!mounted) return null;

  return (
    <OxygenUIThemeProvider theme={theme}>
      {/* Paints the body: the theme's background gradient lives here. */}
      <CssBaseline />
      {children}
    </OxygenUIThemeProvider>
  );
}
