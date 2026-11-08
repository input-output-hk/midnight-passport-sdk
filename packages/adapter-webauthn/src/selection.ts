import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { CredentialPort, PasskeyCredential } from '@input-output-hk/mn-passport-account/ports';
import { equalBytes } from './webauthn.js';

const refused = () =>
  new PassportConnectorError('NotAuthorised', 'Another credential scope is active.');
const idHex = (id: Uint8Array) =>
  Array.from(id, (byte) => byte.toString(16).padStart(2, '0')).join('');
const copy = (value: PasskeyCredential): PasskeyCredential => ({
  credentialId: Uint8Array.from(value.credentialId),
  publicKey: { ...value.publicKey },
  policy: {
    rp_id_hash: Uint8Array.from(value.policy.rp_id_hash),
    origin: Uint8Array.from(value.policy.origin),
  },
});

/** Internal selection ownership. Public bindings are copies; epochs cannot adopt old identities. */
export function createPasskeySelection(busy: () => boolean, canBind: () => boolean) {
  const known = new Map<string, PasskeyCredential>();
  let current: PasskeyCredential | undefined;
  let id: Uint8Array | undefined;
  let revision = 0;
  let selecting = false;
  const checkAvailable = () => {
    if (selecting) throw refused();
  };
  const selected = () => {
    checkAvailable();
    if (!current) throw new PassportConnectorError('InternalError', 'No passkey was selected.');
    return current;
  };
  return {
    checkAvailable,
    begin(loginIdentification = false) {
      checkAvailable();
      if (busy() && !loginIdentification) throw refused();
      selecting = true;
      return ++revision;
    },
    finish(ticket: number) {
      if (revision === ticket) selecting = false;
    },
    commit(ticket: number, credentialId: Uint8Array, created?: PasskeyCredential) {
      if (!selecting || revision !== ticket) throw refused();
      id = Uint8Array.from(credentialId);
      current = created ?? known.get(idHex(id));
      if (created) known.set(idHex(id), created);
    },
    adopt(
      ticket: number,
      identity: Awaited<ReturnType<CredentialPort['identify']>>,
      key: Parameters<Awaited<ReturnType<CredentialPort['identify']>>['owns']>[0],
      policy: Parameters<Awaited<ReturnType<CredentialPort['identify']>>['owns']>[1],
    ) {
      const publicKey = { ...key, identity: false as const };
      if (
        selecting ||
        revision !== ticket ||
        !canBind() ||
        !policy ||
        !id ||
        !equalBytes(identity.credentialId, id)
      )
        return false;
      const admitted = copy({ credentialId: id, publicKey, policy });
      if (
        selecting ||
        revision !== ticket ||
        !canBind() ||
        !identity.owns(admitted.publicKey, admitted.policy)
      )
        return false;
      current = admitted;
      known.set(idHex(id), current);
      return true;
    },
    snapshot: () => copy(selected()),
    prfSelection() {
      checkAvailable();
      if (!id) throw new PassportConnectorError('InternalError', 'No passkey was selected.');
      return { credentialId: Uint8Array.from(id), ...(current && { created: current }) };
    },
    checkCredential(expected: Uint8Array | undefined) {
      if (!expected || !id || !equalBytes(expected, id))
        throw new PassportConnectorError('NotAuthorised', 'The login credential does not match.');
    },
    pin(expected: Uint8Array | undefined) {
      const held = selected();
      const at = revision;
      if (!expected || !equalBytes(expected, held.credentialId)) throw refused();
      return {
        credential: copy(held),
        check() {
          checkAvailable();
          if (revision !== at || current !== held) throw refused();
        },
      };
    },
    checkpoint() {
      const at = revision;
      return () => {
        if (revision !== at) throw refused();
      };
    },
  };
}
