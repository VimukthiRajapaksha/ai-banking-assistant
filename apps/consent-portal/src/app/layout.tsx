import type { Metadata } from 'next';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import { withBase } from '@/lib/basePath';
import { Providers } from './providers';

export const metadata: Metadata = {
  // The same "<portal> | ApexBank" form the bank portal uses.
  title: 'Consent Portal | ApexBank',
  icons: { icon: withBase('/apex-logo.png'), apple: withBase('/apex-logo.png') },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- one font, app-wide, same as the bank portal */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap"
        />
      </head>
      <body style={{ margin: 0, fontFamily: "'Inter', sans-serif", WebkitFontSmoothing: 'antialiased' }}>
        {/* Sets light/dark before first paint, so a dark-mode customer does
            not see a white flash while the theme hydrates. */}
        <InitColorSchemeScript attribute="data-color-scheme" />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
