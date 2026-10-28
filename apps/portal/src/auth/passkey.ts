/** The WebAuthn half of the payment step-up.
 *
 * The MCP server drives the ceremony: it starts the flow with ThunderID and
 * sends the challenge out through the chat's elicitation channel. This module
 * does the one part that can only happen in the browser -- asking the
 * authenticator to sign it -- and hands the signed response straight back.
 *
 * Nothing here decides anything. It cannot weaken the step-up by getting the
 * options wrong, because ThunderID verifies the signature against the
 * challenge it issued and the credential it registered; a tampered request
 * simply fails there.
 */

/** base64url, which is what WebAuthn uses and `atob` does not understand. */
function fromBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(padded.length + ((4 - (padded.length % 4)) % 4), '='));
  // Returns the ArrayBuffer rather than the view: WebAuthn's BufferSource is
  // typed against ArrayBuffer specifically, and a Uint8Array over an
  // ArrayBufferLike does not satisfy it.
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return bytes.buffer as ArrayBuffer;
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  // Chunked rather than spread: a long attestation object as a single
  // String.fromCharCode(...) argument list overflows the call stack.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export class PasskeyError extends Error {}

/** Create a passkey from ThunderID's registration options.
 *
 * The mirror of signStepUpChallenge: that one signs a challenge with an
 * existing credential, this one makes the credential in the first place. Both
 * run at this origin, which is why both produce a credential bound to
 * `portal.apex.localhost` -- and why the passkey enrolled here is the same one
 * the in-chat payment confirmation later asks for.
 */
export async function createPasskey(optionsJson: string): Promise<{
  credentialId: string;
  clientDataJSON: string;
  attestationObject: string;
}> {
  if (!window.PublicKeyCredential) {
    throw new PasskeyError('This browser cannot use passkeys.');
  }

  let options: {
    challenge: string;
    rp: { id: string; name: string };
    user: { id: string; name: string; displayName: string };
    pubKeyCredParams: PublicKeyCredentialParameters[];
    timeout?: number;
    attestation?: AttestationConveyancePreference;
    authenticatorSelection?: AuthenticatorSelectionCriteria;
  };
  try {
    options = JSON.parse(optionsJson);
  } catch {
    throw new PasskeyError('The registration request could not be read.');
  }

  const request: PublicKeyCredentialCreationOptions = {
    ...options,
    challenge: fromBase64Url(options.challenge),
    user: { ...options.user, id: fromBase64Url(options.user.id) },
  };

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.create({ publicKey: request })) as PublicKeyCredential | null;
  } catch (err) {
    // Dismissing the device prompt is a choice, not a fault.
    if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
      throw new PasskeyError('cancelled');
    }
    throw new PasskeyError(err instanceof Error ? err.message : 'Could not create a passkey.');
  }
  if (!credential) throw new PasskeyError('cancelled');

  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    credentialId: credential.id,
    clientDataJSON: toBase64Url(response.clientDataJSON),
    attestationObject: toBase64Url(response.attestationObject),
  };
}

/** Sign a step-up challenge, returning what ThunderID's flow expects.
 *
 * The result is serialised to a string because it travels back inside an
 * elicitation answer, whose values are plain scalars -- the schema is
 * normalised on the wire and a nested object would not survive.
 */
export async function signStepUpChallenge(challengeJson: string): Promise<string> {
  if (!window.PublicKeyCredential) {
    throw new PasskeyError('This browser cannot use passkeys.');
  }

  let options: {
    challenge: string;
    rpId?: string;
    timeout?: number;
    userVerification?: UserVerificationRequirement;
    allowCredentials?: { type: string; id: string }[];
  };
  try {
    options = JSON.parse(challengeJson);
  } catch {
    throw new PasskeyError('The confirmation request could not be read.');
  }

  const request: PublicKeyCredentialRequestOptions = {
    challenge: fromBase64Url(options.challenge),
    rpId: options.rpId,
    timeout: options.timeout,
    userVerification: options.userVerification ?? 'preferred',
    allowCredentials: (options.allowCredentials ?? []).map((c) => ({
      type: 'public-key' as const,
      id: fromBase64Url(c.id),
    })),
  };

  let credential: PublicKeyCredential | null;
  try {
    credential = (await navigator.credentials.get({ publicKey: request })) as PublicKeyCredential | null;
  } catch (err) {
    // A cancelled prompt is the customer declining, not a fault, and it must
    // not be reported as one -- they chose not to confirm a payment.
    if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'AbortError')) {
      throw new PasskeyError('cancelled');
    }
    throw new PasskeyError(err instanceof Error ? err.message : 'Confirmation failed.');
  }
  if (!credential) {
    throw new PasskeyError('cancelled');
  }

  const response = credential.response as AuthenticatorAssertionResponse;
  return JSON.stringify({
    credentialId: credential.id,
    clientDataJSON: toBase64Url(response.clientDataJSON),
    authenticatorData: toBase64Url(response.authenticatorData),
    signature: toBase64Url(response.signature),
    userHandle: response.userHandle ? toBase64Url(response.userHandle) : '',
  });
}
