/** Remembers that the customer asked to add a passkey, across the sign-out and
 * sign-in that proving it requires.
 *
 * Adding an authentication factor has to be backed by a fresh authentication,
 * and ThunderID cannot be asked for one: it validates `prompt=login` and
 * `max_age` and then ignores both outside the `prompt=none` path. So the portal
 * ends the session and lets the customer sign in again on ThunderID's own page
 * -- which is also where their password belongs.
 *
 * The round trip destroys every bit of in-memory state, so the intent is
 * written down first and picked up on the way back.
 */
const KEY = 'apex.settings.enrol-passkey';

export function rememberEnrolIntent(): void {
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* storage blocked; the customer can start again from Settings */
  }
}

/** Single use: reading it clears it, so a later refresh does not re-open the
 * dialog for a request that was already served. */
export function takeEnrolIntent(): boolean {
  try {
    const at = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!at) return false;
    // A stale marker from an abandoned attempt should not surprise someone who
    // signed in for their own reasons much later.
    return Date.now() - Number(at) < 5 * 60 * 1000;
  } catch {
    return false;
  }
}
