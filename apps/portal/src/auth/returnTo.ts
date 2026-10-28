/** Where to put the customer back after the IdP round trip.
 *
 * The redirect_uri is a fixed, registered path (/oauth/callback), so the route
 * they were actually heading for has to be carried across the redirect
 * ourselves -- the same job Auth0's `appState.returnTo` and MSAL's
 * `navigateToLoginRequestUrl` do. Without it every sign-in lands on the
 * dashboard, which is wrong the moment this app grows a second route.
 *
 * sessionStorage: one tab, one sitting, and it must not outlive the browser.
 */
const RETURN_TO = 'apex.auth.returnTo';

/** Query parameters that belong to the OAuth exchange rather than to the app.
 *
 * They have to come off before the location is remembered. A sign-out lands on
 * `/?state=sign_out_success`, and restoring that verbatim after the next
 * sign-in put the customer back on a URL that only described the *previous*
 * session ending. Genuine app parameters (`?tab=loans`) are kept. */
const PROTOCOL_PARAMS = ['code', 'state', 'error', 'error_description', 'session_state', 'iss', 'nonce'];

/** Remember the current location, unless we are already on the callback route
 * (returning there after sign-in would restart the exchange). */
export function rememberReturnTo(callbackPath: string): void {
  const { pathname, search, hash } = window.location;
  if (pathname === callbackPath) return;
  const params = new URLSearchParams(search);
  for (const name of PROTOCOL_PARAMS) params.delete(name);
  const query = params.toString();
  sessionStorage.setItem(RETURN_TO, `${pathname}${query ? `?${query}` : ''}${hash}`);
}

/** Read and consume it. Single use: a stale value must not hijack a later
 * sign-in. Only same-origin, path-only values are honoured -- anything else
 * would make this an open redirect. */
export function takeReturnTo(): string {
  const value = sessionStorage.getItem(RETURN_TO);
  sessionStorage.removeItem(RETURN_TO);
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}
