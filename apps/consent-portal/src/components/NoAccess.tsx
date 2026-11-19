'use client';

import { EmptyState } from './consent/EmptyState';

/** Signed in, but the token does not carry the consent-reading scope -- an
 * application or role misconfiguration, not something the customer can fix. */
export function NoAccess() {
  return (
    <EmptyState
      title="You can't view consents here"
      body="Your sign-in did not include access to consents. Contact the bank if you think this is a mistake."
    />
  );
}
