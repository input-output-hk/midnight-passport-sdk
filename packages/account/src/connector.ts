import {
  PASSPORT_CONNECTOR_VERSION,
  type PassportAccount,
  type PassportConnectorAPI,
} from '@midnight-ntwrk/mn-passport-protocol';
import { fromHex } from './codec.js';
import { PassportConnectorError, toPassportError } from './errors.js';
import type { AccountRecord, PassportSeams } from './seams.js';

/** How many use counters past the last known one the rescan probes (MIP-0013 S11). */
export const RESCAN_LIMIT = 64;

export function createPassportConnector(seams: PassportSeams): PassportConnectorAPI {
  const { chain, passkey, registry, pureCircuits, networkId } = seams;

  const activate = async (record: AccountRecord): Promise<AccountRecord> => {
    await chain.call(record.address, 'activate_initial_device_with_p256', [
      record.publicKey,
      record.salt,
      record.policy,
    ]);
    const active: AccountRecord = { ...record, status: 'active' };
    await registry.put(networkId, active);
    return active;
  };

  const useCounter = async (
    record: AccountRecord,
  ): Promise<{ counter: bigint; authNonce: bigint }> => {
    const view = await chain.readLedger(record.address);
    if (!view)
      throw new PassportConnectorError('AccountNotFound', `No contract at ${record.address}.`);
    const self = { bytes: fromHex(record.address) };
    for (let k = 0n; k < BigInt(RESCAN_LIMIT); k++) {
      const entry = pureCircuits.derive_device_entry_with_p256(
        self,
        record.publicKey,
        record.policy,
        view.deviceEpoch,
        k,
      );
      if (view.hasEntry(entry)) return { counter: k, authNonce: view.authNonce };
    }
    throw new PassportConnectorError(
      'AccountNotFound',
      'This passkey has no live entry on the account.',
    );
  };

  const account = (record: AccountRecord): PassportAccount => ({
    address: record.address,
    networkId,
    bindingId: seams.bindingId,
    async state() {
      const view = await chain.readLedger(record.address);
      if (!view)
        throw new PassportConnectorError('AccountNotFound', `No contract at ${record.address}.`);
      return {
        booted: view.booted,
        authNonce: view.authNonce,
        deviceEpoch: view.deviceEpoch,
        entryCount: view.entryCount,
        specVersion: view.specVersion,
      };
    },
    async rotateEncryptionKey(newKey) {
      try {
        const { counter, authNonce } = await useCounter(record);
        const self = { bytes: fromHex(record.address) };
        const challenge = pureCircuits.challenge_rotate_enc_key_with_p256(
          self,
          record.publicKey,
          newKey,
          authNonce,
        );
        const credential = {
          credentialId: record.credentialId,
          publicKey: record.publicKey,
          policy: record.policy,
        };
        const signed = await passkey.sign(credential, challenge);
        const auth = {
          pk: record.publicKey,
          policy: record.policy,
          ...signed,
          use_counter: counter,
        };
        return await chain.call(record.address, 'rotate_enc_key_with_p256', [newKey, auth]);
      } catch (e) {
        throw toPassportError(e);
      }
    },
  });

  return {
    apiVersion: PASSPORT_CONNECTOR_VERSION,
    networkId,
    async createAccount({ userName, onProgress }) {
      try {
        const credential = await passkey.create(userName);
        onProgress?.('passkey-created');
        const salt = seams.random(32);
        const boot = pureCircuits.derive_boot_commitment_with_p256(
          salt,
          credential.publicKey,
          credential.policy,
        );
        onProgress?.('deploying');
        const { address } = await chain.deploy({ boot, encKey: seams.encryptionKey() });
        const deployed: AccountRecord = { ...credential, address, salt, status: 'deployed' };
        // Recorded before activation: the salt is the only way to activate (Review Focus 2).
        await registry.put(networkId, deployed);
        onProgress?.('deployed');
        onProgress?.('activating');
        const active = await activate(deployed);
        onProgress?.('active');
        return account(active);
      } catch (e) {
        throw toPassportError(e);
      }
    },
    async openAccount() {
      try {
        const { credentialId } = await passkey.identify();
        const record = await registry.get(networkId, credentialId);
        if (!record)
          throw new PassportConnectorError(
            'AccountNotFound',
            'No Passport account for this passkey on this network.',
          );
        return account(record.status === 'active' ? record : await activate(record));
      } catch (e) {
        throw toPassportError(e);
      }
    },
  };
}
