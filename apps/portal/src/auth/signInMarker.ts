/** Marks that a redirect to the IdP has been started and not yet completed.
 *
 * The loop this breaks is a *fast* one: a login that succeeds at the IdP while
 * this app fails to persist the session (blocked storage, a cookie policy,
 * clock skew) sends the customer straight back, and redirecting again on
 * arrival spins forever. Coming back signed out within seconds of leaving is
 * that signature.
 *
 * So the marker carries the time it was written, and only counts as a failed
 * attempt inside that window. Without the clock it was just "a redirect was
 * started once in this tab", which also describes a sign-in the customer
 * simply abandoned -- and it left the tab showing "we could not complete
 * sign-in" on every later visit, when the right answer was to send them to
 * sign in again.
 *
 * sessionStorage, to match the SDK's own storage: one tab, one sitting.
 */
const REDIRECT_MARKER = 'apex.auth.redirecting';

/** How soon a signed-out return counts as the loop rather than a fresh visit.
 * Comfortably longer than a redirect round trip, far shorter than a person
 * going away and coming back. */
const LOOP_WINDOW_MS = 90_000;

export function signInAttemptPending(): boolean {
  const raw = sessionStorage.getItem(REDIRECT_MARKER);
  if (raw === null) return false;
  const startedAt = Number(raw);
  // An unparseable value is a marker from an older build; treat it as stale
  // rather than wedging the page on it.
  if (!Number.isFinite(startedAt)) return false;
  return Date.now() - startedAt < LOOP_WINDOW_MS;
}

export function markSignInAttempt(): void {
  sessionStorage.setItem(REDIRECT_MARKER, String(Date.now()));
}

export function clearSignInMarker(): void {
  sessionStorage.removeItem(REDIRECT_MARKER);
}
