/** Whether THIS browser has been set up with a passkey, as far as we can tell.
 *
 * Deliberately a record of what happened here, not a claim about the account.
 * ThunderID exposes no way to ask whether a customer has a passkey -- every
 * passkey route is a POST ceremony, and the one probe that would answer it
 * (`/auth/passkey/start`, 200 versus AUTHN-PSK-1001) needs a Direct-Auth-Secret
 * this system does not hold. The browser will not say either: answering "do you
 * have a credential for me?" without a user gesture is a fingerprinting vector,
 * so no API offers it.
 *
 * That is not really a gap, because the account-level question is the wrong
 * one. A passkey belongs to a device. A customer with one on their laptop still
 * needs one on their phone, so the action stays available either way and the
 * card describes THIS device rather than asserting something about the account.
 *
 * localStorage, not sessionStorage: the fact outlives the sitting, the way the
 * credential does. Keyed by subject so two people sharing a browser profile do
 * not read each other's state. It can still go stale -- a credential removed at
 * the IdP leaves this behind -- which is exactly why it only ever softens the
 * wording and never hides the button.
 */
const PREFIX = 'apex.passkey.device.';

/** The `sub` of an ID token, without verifying it.
 *
 * Safe here because nothing is authorised by it: it only picks which key this
 * browser writes its own note under. Every decision that matters is made
 * server-side against a token it verified.
 */
export function subjectOf(idToken: string | undefined): string | undefined {
  if (!idToken) return undefined;
  try {
    const body = idToken.split('.')[1];
    const claims = JSON.parse(atob(body.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string };
    return claims.sub;
  } catch {
    return undefined;
  }
}

export function markDeviceEnrolled(subject: string): void {
  try {
    localStorage.setItem(PREFIX + subject, String(Date.now()));
  } catch {
    /* storage blocked; the card simply stays in its neutral wording */
  }
}

export function deviceEnrolled(subject: string | undefined): boolean {
  if (!subject) return false;
  try {
    return localStorage.getItem(PREFIX + subject) !== null;
  } catch {
    return false;
  }
}
