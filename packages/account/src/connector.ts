import {
  PASSPORT_CONNECTOR_VERSION,
  type PassportAccount,
  type PassportConnectorAPI,
} from '@midnight-ntwrk/mn-passport-protocol';
import { fromHex } from './codec.js';
import { PassportConnectorError, toPassportError } from './errors.js';
import type { AccLedgerView, AccountRecord, PassportSeams } from './seams.js';

const equalBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * The rescan probes use counters 0..RESCAN_LIMIT-1 (MIP-0013 S11). The prototype always starts at 0,
 * so an account allows 64 authorised calls per passkey entry.
 */
export const RESCAN_LIMIT = 64;

export function createPassportConnector(seams: PassportSeams): PassportConnectorAPI {
  const { chain, passkey, registry, pureCircuits, networkId } = seams;

  const submitActivation = (record: AccountRecord) =>
    chain.call(record.address, 'activate_initial_device_with_p256', [
      record.publicKey,
      record.salt,
      record.policy,
    ]);

  const activate = async (record: AccountRecord): Promise<AccountRecord> => {
    await submitActivation(record);
    const active: AccountRecord = { ...record, status: 'active' };
    await registry.put(networkId, active);
    return active;
  };

  const readView = async (record: AccountRecord): Promise<AccLedgerView> => {
    const view = await chain.readLedger(record.address);
    if (!view)
      throw new PassportConnectorError('AccountNotFound', `No contract at ${record.address}.`);
    return view;
  };

  /** The 0..RESCAN_LIMIT-1 counter scan: the counter of this passkey's live entry, if any. */
  const findCounter = (record: AccountRecord, view: AccLedgerView): bigint | undefined => {
    const self = { bytes: fromHex(record.address) };
    for (let k = 0n; k < BigInt(RESCAN_LIMIT); k++) {
      const entry = pureCircuits.derive_device_entry_with_p256(
        self,
        record.publicKey,
        record.policy,
        view.deviceEpoch,
        k,
      );
      if (view.hasEntry(entry)) return k;
    }
    return undefined;
  };

  const notHeld = (record: AccountRecord) =>
    new PassportConnectorError(
      'AccountNotFound',
      `The account at ${record.address} does not hold this passkey.`,
    );

  const useCounter = async (
    record: AccountRecord,
  ): Promise<{ counter: bigint; authNonce: bigint }> => {
    const view = await readView(record);
    const counter = findCounter(record, view);
    if (counter === undefined) {
      throw new PassportConnectorError(
        'AccountNotFound',
        'This passkey has no live entry on the account.',
      );
    }
    return { counter, authNonce: view.authNonce };
  };

  /**
   * Completes a 'deployed' record whose passkey `openAccount` has already verified. Activation may
   * already have landed on-chain while its response or the registry write was lost, so a booted
   * ledger is adopted instead of activating a second time, but only once it holds this passkey.
   * An unbooted ledger is activated: its boot commitment binds pk, salt and policy on chain, so a
   * mismatched record cannot activate someone else's account, and the entry is checked afterwards
   * all the same before the record is marked active.
   */
  const finishActivation = async (
    record: AccountRecord,
    view: AccLedgerView,
  ): Promise<AccountRecord> => {
    if (!view.booted) {
      await submitActivation(record);
      if (findCounter(record, await readView(record)) === undefined) throw notHeld(record);
    }
    const active: AccountRecord = { ...record, status: 'active' };
    await registry.put(networkId, active);
    return active;
  };

  const account = (record: AccountRecord): PassportAccount => ({
    address: record.address,
    networkId,
    bindingId: seams.bindingId,
    async state() {
      const view = await readView(record);
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
        const identity = await passkey.identify();
        const record = await registry.get(networkId, identity.credentialId);
        if (!record)
          throw new PassportConnectorError(
            'AccountNotFound',
            'No Passport account for this passkey on this network.',
          );
        // The registry is an untrusted hint (Ruling R10(b)): the record must name the picked
        // passkey's own key, the address must hold a ledger, and that ledger must hold the passkey.
        if (
          !equalBytes(record.credentialId, identity.credentialId) ||
          !identity.owns(record.publicKey, record.policy)
        ) {
          throw new PassportConnectorError(
            'AccountNotFound',
            'The registry record does not belong to this passkey.',
          );
        }
        const view = await readView(record);
        if ((record.status === 'active' || view.booted) && findCounter(record, view) === undefined)
          throw notHeld(record);
        return account(record.status === 'active' ? record : await finishActivation(record, view));
      } catch (e) {
        throw toPassportError(e);
      }
    },
  };
}
