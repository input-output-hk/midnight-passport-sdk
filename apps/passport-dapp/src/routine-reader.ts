import type { AccountViewingKey, PrfKeySource } from '@input-output-hk/mn-passport-account/ports';
import { recipeDeviceKeyring, READER_SECRET_DOMAIN } from '@input-output-hk/mn-passport-keys';
import type { RoutineContext } from './routine-keys.js';

/** A bounded read-only capability; it cannot derive a wallet seed, sign or seal new entries. */
export function createRoutineReader(
  context: RoutineContext,
  check: () => void,
  reader: () => Uint8Array,
): Pick<AccountViewingKey, 'openInbox'> {
  const source: PrfKeySource = {
    async withSession(work) {
      check();
      const result = await work();
      check();
      return result;
    },
    async deviceSecret() {
      throw new Error('Routine reading cannot access an owner signing key.');
    },
    async deriveSecret(params) {
      check();
      if (
        params.domain !== READER_SECRET_DOMAIN ||
        params.context !== context.networkId ||
        (params.length ?? 32) !== 32
      )
        throw new Error('Routine reader cannot derive another key.');
      return reader();
    },
  };
  const keyring = recipeDeviceKeyring(source);
  return {
    async openInbox(network, keys, entries) {
      check();
      if (network !== context.networkId || keys.account !== context.account)
        throw new Error('Routine reader context mismatch.');
      return keyring.openInbox(network, keys, entries);
    },
  };
}
