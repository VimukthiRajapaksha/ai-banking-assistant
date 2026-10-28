import { useEffect, useRef, useState } from 'react';
import { useAsgardeo } from '@asgardeo/react';
import { config } from '../config';

interface UserProfile {
  givenName?: string;
  familyName?: string;
  email?: string;
  /** Best available name for display. */
  displayName?: string;
  /** One or two characters for the avatar, or undefined -- never a placeholder. */
  initial?: string;
  /** The `sub` claim -- the user's identifier at the IdP, used when approving
   * a consent under their own identity. */
  subject?: string;
}

/** The signed-in customer, for display.
 *
 * `sub` comes from the ID token, which always carries it. The name and email
 * do not: Asgardeo returns those from the OIDC UserInfo endpoint rather than
 * putting them in the ID token, so the token alone yields nothing to show and
 * the avatar fell back to a placeholder.
 *
 * UserInfo, not SCIM2 `/scim2/Me`: this app isn't authorized for SCIM2, and
 * the SDK's own profile fetching is switched off in main.tsx because every
 * failed attempt triggered a token-refresh cascade that ended up marking the
 * session signed-out. UserInfo is a standard OIDC endpoint that accepts the
 * session's own access token and needs no extra permission.
 *
 * A failure here is not an error worth surfacing -- it costs a name on an
 * avatar, nothing more -- so it degrades to the subject alone.
 */
export function useIdTokenProfile(): UserProfile {
  const { isSignedIn, getDecodedIdToken, getAccessToken } = useAsgardeo();
  const [profile, setProfile] = useState<UserProfile>({});

  // The SDK hands back a fresh `getAccessToken` on every render, so listing it
  // as a dependency restarts this effect continuously: each run cancels the
  // previous fetch before it resolves, and the profile never settles. Held in
  // a ref so the effect depends only on whether someone is signed in.
  const sdk = useRef({ getDecodedIdToken, getAccessToken });
  useEffect(() => {
    sdk.current = { getDecodedIdToken, getAccessToken };
  });

  useEffect(() => {
    if (!isSignedIn) {
      setProfile({});
      return;
    }
    let cancelled = false;

    async function load() {
      const claims = await sdk.current.getDecodedIdToken();
      if (cancelled) return;

      let info: Record<string, string> = {};
      try {
        const response = await fetch(`${config.auth.baseUrl}/oauth2/userinfo`, {
          headers: { Authorization: `Bearer ${await sdk.current.getAccessToken()}` },
        });
        if (response.ok) info = await response.json();
      } catch {
        // Display-only. Keep the subject we already have.
      }
      if (cancelled) return;

      const givenName = info.given_name;
      const familyName = info.family_name;
      const email = info.email ?? info.username;
      const fullName = [givenName, familyName].filter(Boolean).join(' ');
      const displayName = fullName || email;
      // Two initials when there is a real first and last name, one otherwise --
      // "VR" reads as a person, the first letter of an email address does not.
      const initial =
        givenName && familyName
          ? `${givenName[0]}${familyName[0]}`.toUpperCase()
          : displayName?.trim()?.[0]?.toUpperCase();

      setProfile({
        givenName,
        familyName,
        email,
        displayName: displayName || undefined,
        initial,
        subject: claims.sub,
      });
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  return profile;
}
