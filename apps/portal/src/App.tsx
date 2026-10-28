import { useEffect, useState } from 'react';
import { AppShell, Box, CircularProgress } from '@wso2/oxygen-ui';
import { SignedIn, SignedOut, useAsgardeo } from '@asgardeo/react';
import { AutoSignIn } from './auth/AutoSignIn';
import { takeReturnTo } from './auth/returnTo';
import { clearSignInMarker } from './auth/signInMarker';
import { config } from './config';
import { TopAppBar } from './components/layout/TopAppBar';
import { SideNav } from './components/layout/SideNav';
import { Dashboard } from './pages/Dashboard';
import { ChatWidget } from './chat-widget/ChatWidget';

function CenteredScreen({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{children}</Box>
  );
}

export function App() {
  const { isInitialized, isSignedIn } = useAsgardeo();
  const [navOpen, setNavOpen] = useState(true);

  // A completed sign-in is what retires the redirect marker. Left set, the
  // next signed-out render would read it as a failed attempt and stop.
  //
  // It is also the moment the callback route has served its purpose. The SDK
  // strips `code`/`state` from the URL but never touches the path, so without
  // this the customer sits on /oauth/callback for the rest of the session.
  // replaceState, not push: the callback must not become a history entry the
  // back button can return to, where the code has already been redeemed.
  useEffect(() => {
    if (!isSignedIn) return;
    clearSignInMarker();
    if (window.location.pathname === config.auth.callbackPath) {
      window.history.replaceState({}, '', takeReturnTo());
    }
  }, [isSignedIn]);

  // Startup only -- deliberately NOT the SDK's <Loading>, which follows
  // `isLoading`. That flag is raised for any background SDK call, including
  // the chat widget's token exchange, and the provider polls it into React
  // state every 100ms; rendering a full-height spinner off it made the
  // dashboard jump down and back on the first chat message. isInitialized
  // goes false -> true exactly once and stays true.
  if (!isInitialized) {
    return (
      <CenteredScreen>
        <CircularProgress />
      </CenteredScreen>
    );
  }

  return (
    <>
      <SignedOut>
        <CenteredScreen>
          <AutoSignIn />
        </CenteredScreen>
      </SignedOut>

      <SignedIn>
        {/* The same shell the consent portal is built on, so header, sidebar
            and content sit and move identically in both. */}
        <AppShell collapseOnSelectOnMobile>
          <AppShell.Navbar>
            <TopAppBar navOpen={navOpen} onToggleNav={() => setNavOpen((v) => !v)} />
          </AppShell.Navbar>
          <AppShell.Sidebar>
            <SideNav open={navOpen} />
          </AppShell.Sidebar>
          <AppShell.Main>
            <Dashboard />
          </AppShell.Main>
        </AppShell>
        <ChatWidget />
      </SignedIn>
    </>
  );
}
