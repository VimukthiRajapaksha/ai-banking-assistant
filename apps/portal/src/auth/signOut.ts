import { config } from '../config';

/** Where the browser goes to actually sign out.
 *
 * The SDK's own `signOut()` cannot be used here. On the `AsgardeoV2` platform
 * (which is what ThunderID is) it clears local session state and then calls
 * `signIn()` again -- it never visits the end-session endpoint. The customer
 * is bounced straight back in, still holding the ThunderID SSO session they
 * asked to end, which on a shared machine is the opposite of what "Log out"
 * promises.
 *
 * So the portal performs the RP-initiated logout itself: OpenID Connect
 * RP-Initiated Logout 1.0, the `end_session_endpoint` from discovery.
 * ThunderID runs the application's sign-out flow, terminates the SSO session,
 * clears the per-flow cookie, and returns here.
 *
 * `client_id` rather than `id_token_hint`: the hint is the recommended
 * parameter and would let ThunderID skip its confirmation check, but reading
 * the raw ID token back out of the SDK means reaching into its storage. The
 * default sign-out flow ends the session without prompting either way, and
 * `client_id` alone is explicitly allowed -- at least one of the two must be
 * present.
 *
 * `post_logout_redirect_uri` must EXACTLY match one registered on the
 * application (`postLogoutRedirectUris`), or ThunderID answers 400.
 */
/** Drop everything this app holds about the session, before leaving for the IdP.
 *
 * Done explicitly rather than through the SDK's `signOut()`, which on this
 * platform clears state and then immediately starts a new sign-in -- racing the
 * navigation below, with whichever wins deciding whether the customer is
 * actually logged out.
 *
 * Targeted rather than `sessionStorage.clear()`: the SDK namespaces its keys by
 * client id, and the chat widget keeps its own unrelated state alongside them.
 */
export function clearLocalSession(): void {
  for (const key of Object.keys(sessionStorage)) {
    if (key.includes(config.auth.clientId) || key.startsWith('asgardeo')) {
      sessionStorage.removeItem(key);
    }
  }
  try {
    localStorage.removeItem('asgardeo-session-active');
  } catch {
    // A browser with site data blocked; nothing was stored to begin with.
  }
}

export function signOutUrl(): string {
  const params = new URLSearchParams({
    client_id: config.auth.clientId,
    post_logout_redirect_uri: config.auth.afterSignOutUrl,
    // Echoed back on the return, and what tells the auto-sign-in guard that
    // arriving here was a deliberate sign-out rather than a fresh visit.
    state: 'sign_out_success',
  });
  return `${config.auth.endSessionUrl}?${params.toString()}`;
}
