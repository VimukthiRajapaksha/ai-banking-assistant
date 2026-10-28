import { useEffect, useRef, useState } from 'react';
import { Box, Button, Dialog, IconButton, Typography } from '@wso2/oxygen-ui';
import { CircleCheck, FingerprintPattern, Settings, X } from '@wso2/oxygen-ui-icons-react';
import { useAsgardeo } from '@asgardeo/react';
import { PasskeyError, createPasskey } from '../../auth/passkey';
import { clearLocalSession, signOutUrl } from '../../auth/signOut';
import { config } from '../../config';
import { SettingSection } from './SettingSection';
import { rememberEnrolIntent } from './enrolIntent';
import { deviceEnrolled, markDeviceEnrolled, subjectOf } from './deviceEnrolment';
import { useIdTokenProfile } from '../../auth/useIdTokenProfile';

type State = 'idle' | 'working' | 'done' | 'error';

/** Settings, which today means one thing: the passkey that authorises payments.
 *
 * A dialog rather than a dashboard card because this is account administration,
 * not account information -- it belongs behind the settings control, next to
 * the things a customer changes rather than the things they read.
 *
 * **There is no password box here, deliberately.** Adding an authentication
 * factor has to be backed by a fresh authentication, but the WebAuthn ceremony
 * must run at this origin while ThunderID only collects passwords on its own
 * hosted page at a different one. Asking here would mean a banking password
 * typed into a box this app renders and forwarded through our services --
 * which is what federated identity exists to avoid, and which teaches the
 * habit that makes phishing work. So the customer is signed out and back in
 * instead, types the password where it belongs, and the relay proves it from
 * the `auth_time` on the resulting ID token.
 */
export function SettingsDialog({
  open,
  onClose,
  autoEnrol = false,
}: {
  open: boolean;
  onClose: () => void;
  /** Set when the dialog was reopened after the sign-in this enrolment needed:
   * the customer already asked, so asking again would be a pointless second
   * click on the far side of a redirect. */
  autoEnrol?: boolean;
}) {
  const { getAccessToken, getIdToken } = useAsgardeo();
  const profile = useIdTokenProfile();
  // What this browser has done before -- not a claim about the account, which
  // ThunderID gives us no way to ask about. See deviceEnrolment.ts.
  const knownOnThisDevice = deviceEnrolled(profile.subject);
  const [state, setState] = useState<State>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);

  /** Step one: end the session so ThunderID asks for the password itself.
   *
   * ThunderID cannot be asked for a re-authentication -- it validates
   * `prompt=login` and `max_age` and then ignores both outside the
   * `prompt=none` path -- so ending the session is what forces one. */
  function reauthenticate() {
    rememberEnrolIntent();
    clearLocalSession();
    window.location.assign(signOutUrl());
  }

  /** Step two, on the way back: the ID token from the sign-in that just
   * happened is the proof, and the relay checks its `auth_time`. */
  async function enrol() {
    setState('working');
    setMessage(null);
    try {
      const [token, idToken] = await Promise.all([getAccessToken(), getIdToken()]);
      const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

      const startedRes = await fetch(`${config.security.baseUrl}/start`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ id_token: idToken }),
      });
      if (startedRes.status === 401 || startedRes.status === 403) {
        throw new Error('That sign-in was too long ago. Try again to add a passkey.');
      }
      if (!startedRes.ok) throw new Error('Could not start passkey setup.');
      const { creation_options: options, execution_id, challenge_token } = await startedRes.json();

      const credential = await createPasskey(options);

      const finished = await fetch(`${config.security.baseUrl}/finish`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          execution_id,
          challenge_token,
          credential_id: credential.credentialId,
          client_data_json: credential.clientDataJSON,
          attestation_object: credential.attestationObject,
        }),
      });
      if (!finished.ok) throw new Error('That passkey could not be registered.');
      // Taken from the token in hand rather than the profile hook: this runs on
      // mount when the dialog reopens itself after the sign-in, and the hook has
      // not necessarily resolved by then.
      const subject = subjectOf(idToken) ?? profile.subject;
      if (subject) markDeviceEnrolled(subject);
      setState('done');
    } catch (err) {
      if (err instanceof PasskeyError && err.message === 'cancelled') {
        setState('idle');
        return;
      }
      setState('error');
      setMessage(err instanceof Error ? err.message : 'Passkey setup failed.');
    }
  }

  // Runs once: the ceremony opens a device prompt, and a second one raised
  // while the first is up is rejected by the browser outright.
  useEffect(() => {
    if (open && autoEnrol && !started.current) {
      started.current = true;
      void enrol();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoEnrol]);

  function close() {
    setState('idle');
    setMessage(null);
    onClose();
  }

  return (
    <Dialog open={open} onClose={close} maxWidth="xs" fullWidth>
      <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Settings size={20} />
          <Typography variant="h6" sx={{ flex: 1 }}>
            Settings
          </Typography>
          <IconButton aria-label="Close settings" onClick={close} size="small">
            <X size={18} />
          </IconButton>
        </Box>

        <SettingSection
          icon={<FingerprintPattern size={20} />}
          title="Passkey"
          description={
            state === 'done'
              ? undefined
              : 'Confirm payments with your fingerprint, face or screen lock. Set it up once on each device you use.'
          }
        >
          {state === 'done' ? (
            <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <CircleCheck size={18} />
              This device is set up. Payments will ask for your passkey from now on.
            </Typography>
          ) : (
            <>
              {/* Says what we actually know -- that this browser was set up --
                  rather than asserting the account has a passkey, which we
                  cannot verify and which would be wrong on a new device. The
                  button stays available either way: a second device needs its
                  own passkey. */}
              {knownOnThisDevice && (
                <Typography
                  variant="body2"
                  sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}
                >
                  <CircleCheck size={18} />
                  This device is already set up.
                </Typography>
              )}
              {message && (
                <Typography variant="caption" color="error">
                  {message}
                </Typography>
              )}
              <Button
                variant={knownOnThisDevice ? 'outlined' : 'contained'}
                disabled={state === 'working'}
                onClick={() => (state === 'error' ? void enrol() : reauthenticate())}
                sx={{ alignSelf: 'flex-start' }}
              >
                {state === 'working'
                  ? 'Waiting for your device…'
                  : state === 'error'
                    ? 'Try again'
                    : knownOnThisDevice
                      ? 'Set up again on this device'
                      : 'Set up on this device'}
              </Button>
            </>
          )}
        </SettingSection>
      </Box>
    </Dialog>
  );
}
