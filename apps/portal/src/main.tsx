import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CssBaseline, OxygenUIThemeProvider } from '@wso2/oxygen-ui';
import { AsgardeoProvider } from '@asgardeo/react';
import { App } from './App';
import { config } from './config';
import { theme } from './theme';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AsgardeoProvider
      baseUrl={config.auth.baseUrl}
      clientId={config.auth.clientId}
      afterSignInUrl={config.auth.afterSignInUrl}
      afterSignOutUrl={config.auth.afterSignOutUrl}
      scopes={config.auth.loginScopes}
      // ThunderID issues scopes per resource indicator (RFC 8707). Without
      // this the token falls back to the server-wide default resource and
      // comes back carrying NONE of the bank scopes -- the gateway then
      // answers 403 on every call while the login itself looks perfect.
      signInOptions={{ resource: config.auth.audience }}
      // ThunderID, which the SDK knows as AsgardeoV2. Without it the SDK
      // auto-detects Asgardeo, skips discovery entirely, and derives endpoints
      // from Asgardeo's URL conventions -- so `end_session_endpoint` becomes
      // /oidc/logout, which ThunderID answers with AUTH-4010, and the issuer
      // becomes {baseUrl}/oauth2/token. Sign-in still works, because
      // /oauth2/authorize happens to match both, which is why the mismatch
      // only ever surfaced at logout.
      platform="AsgardeoV2"
      // Discovery is OFF unless asked for. Without it the SDK derives every
      // endpoint from baseUrl using Asgardeo's paths, and `platform` alone only
      // corrects the issuer -- end_session stays /oidc/logout, which is what
      // produced AUTH-4010 on sign-out. With it, the SDK fetches
      // {baseUrl}/.well-known/openid-configuration, which is where ThunderID
      // serves it, and every endpoint comes from the document.
      discovery={{ wellKnown: { enabled: true } }}
      storage="sessionStorage"
      // ThunderID does not echo the `nonce` back in the id_token. The SDK
      // validates it by default and, when it does not match, discards the
      // session silently -- a successful token exchange followed by a UI that
      // still believes nobody is signed in. Signature, issuer and audience are
      // still checked; only the nonce replay check is off.
      tokenValidation={{ idToken: { validateIssuer: true, clockTolerance: 30, validate: false } }}
      preferences={{ user: { fetchOrganizations: false, fetchUserProfile: false } }}
    >
      <OxygenUIThemeProvider theme={theme}>
        {/* Paints the body: the theme's background gradient lives here. */}
        <CssBaseline />
        <App />
      </OxygenUIThemeProvider>
    </AsgardeoProvider>
  </StrictMode>,
);
