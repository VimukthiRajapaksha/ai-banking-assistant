import { UserMenu } from '@wso2/oxygen-ui';
import { LogOut, ShieldCheck, User } from '@wso2/oxygen-ui-icons-react';
import { clearLocalSession, signOutUrl } from '../../auth/signOut';
import { clearTranscript } from '../../chat-widget/transcript';
import { clearBrowserSessionId } from '../../api/session';
import { useIdTokenProfile } from '../../auth/useIdTokenProfile';
import { config } from '../../config';

/** The account menu behind the avatar.
 *
 * Oxygen UI's own UserMenu rather than a hand-built popover: the trigger,
 * header, items and logout row are all components the design system already
 * ships, so focus handling, keyboard navigation and the avatar's
 * image-or-initials logic come from the library and match every other WSO2
 * product.
 */
export function AccountMenu() {
  const { displayName, email, initial } = useIdTokenProfile();

  // The IdP may send no name at all -- see useIdTokenProfile for why. "Your
  // account" is honest in that case; a "?" would say we don't know who is
  // signed in, which is not what happened.
  const name = displayName ?? 'Your account';

  return (
    <UserMenu>
      <UserMenu.Trigger name={name} avatar={initial} aria-label="Account menu" />
      <UserMenu.Header name={name} email={email ?? ''} avatar={initial} />
      <UserMenu.Divider />

      <UserMenu.Item icon={<User size={18} />} label="My profile" />
      {config.consentPortal.url && (
        <UserMenu.Item
          icon={<ShieldCheck size={18} />}
          label="Consents"
          onClick={() => window.open(config.consentPortal.url, '_blank', 'noopener,noreferrer')}
        />
      )}

      <UserMenu.Divider />
      <UserMenu.Logout
        icon={<LogOut size={18} />}
        onClick={() => {
          clearBrowserSessionId();
          clearTranscript();
          // Clear what this app holds, then end the session at ThunderID.
          // The SDK's `signOut()` is deliberately NOT called: on this platform
          // it clears state and immediately starts a new sign-in, which would
          // race this navigation. See auth/signOut.ts.
          clearLocalSession();
          window.location.assign(signOutUrl());
        }}
      />
    </UserMenu>
  );
}
