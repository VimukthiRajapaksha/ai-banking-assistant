import { useEffect, useRef, useState } from 'react';
import { Box, Button, CircularProgress, Typography } from '@wso2/oxygen-ui';
import { useAsgardeo } from '@asgardeo/react';
import { config } from '../config';

// ThunderID issues scopes per resource indicator (RFC 8707): without one the
// token falls back to the server-wide default resource and comes back with
// none of the bank scopes, so the gateway answers 403 while the login itself
// looks perfect. The provider's own signInOptions only apply to the sign-in it
// triggers itself, so the guard has to pass them on its own call.
const signInParams = { resource: config.auth.audience };
import { rememberReturnTo } from './returnTo';
import { clearSignInMarker, markSignInAttempt, signInAttemptPending } from './signInMarker';

/** Sends an unauthenticated visitor straight to the IdP, with no landing page.
 *
 * The same shape as Auth0's `withAuthenticationRequired` and MSAL's
 * `MsalAuthenticationTemplate`: the redirect is a side effect, the component
 * renders a placeholder, and a manual control is kept for when the automatic
 * path has demonstrably failed.
 */
/** How long the code-for-token exchange is given before the customer is
 * offered a way out. Generous: it is a network round trip on a cold page. */
const EXCHANGE_TIMEOUT_MS = 15_000;

export function AutoSignIn() {
  const { signIn } = useAsgardeo();
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // A ref, not state: StrictMode double-invokes effects in development, and a
  // second signIn() while the first redirect is in flight is what produces
  // duplicate-`state` failures at the IdP.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    const params = new URLSearchParams(window.location.search);

    // The IdP said no, or something failed on the way back. Redirecting again
    // would just repeat it, so surface it and let the customer decide.
    const rejected = params.get('error_description') ?? params.get('error');
    if (rejected) {
      started.current = true;
      clearSignInMarker();
      setError(rejected);
      return;
    }

    // Mid-callback: the SDK is exchanging the code and has not flipped
    // isSignedIn yet. Starting a new authorization here would abort our own.
    // A successful exchange unmounts this component, so the timer only ever
    // fires on an exchange that silently never completed -- without it that
    // ends as a spinner with no way out.
    //
    // Both conditions are needed. `state` alone is not a callback: a completed
    // sign-out returns to the root as `/?state=sign_out_success`, and treating
    // that as an exchange in flight left the customer on a spinner instead of
    // sending them back to sign in.
    const onCallbackRoute = window.location.pathname === config.auth.callbackPath;
    if (onCallbackRoute && params.has('code')) {
      const timer = setTimeout(() => {
        started.current = true;
        clearSignInMarker();
        setError('Sign-in did not complete. Please try again.');
      }, EXCHANGE_TIMEOUT_MS);
      return () => clearTimeout(timer);
    }

    started.current = true;
    if (signInAttemptPending()) {
      clearSignInMarker();
      setError('We could not complete sign-in. Please try again.');
      return;
    }
    // Stale marker from an attempt that was abandoned rather than looping:
    // drop it and treat this as a fresh visit.
    clearSignInMarker();
    markSignInAttempt();
    rememberReturnTo(config.auth.callbackPath);
    signIn(signInParams).catch((err: unknown) => {
      clearSignInMarker();
      setError(err instanceof Error ? err.message : 'Sign-in could not be started.');
    });
  }, [signIn]);

  async function retry() {
    setRetrying(true);
    setError(null);
    clearSignInMarker();
    rememberReturnTo(config.auth.callbackPath);
    try {
      await signIn(signInParams);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in could not be started.');
      setRetrying(false);
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        {/* Decorative: the wordmark beside it already names the bank, so the
            image is hidden from screen readers rather than read out twice. */}
        <Box component="img" src="/apex-logo-96.png" alt="" aria-hidden sx={{ width: 40, height: 40 }} />
        <Box sx={{ fontSize: 32, fontWeight: 800 }}>
          <Box component="span" sx={{ color: 'primary.main' }}>
            Apex
          </Box>
          Bank
        </Box>
      </Box>
      {error ? (
        <>
          <Typography variant="body2" color="error" sx={{ maxWidth: 320, textAlign: 'center' }}>
            {error}
          </Typography>
          <Button variant="contained" size="large" onClick={retry} disabled={retrying} sx={{ px: 4 }}>
            {retrying ? 'Signing in...' : 'Sign in'}
          </Button>
        </>
      ) : (
        <>
          <CircularProgress />
          <Typography variant="body2" color="text.secondary">
            Taking you to sign in...
          </Typography>
        </>
      )}
    </Box>
  );
}
