// Generated ACC execution and real software signatures, without proofs/network/provider UI.
import assert from 'node:assert/strict';
import { createConstructorContext } from '@midnight-ntwrk/compact-runtime';
import { fakeNetwork } from '../../packages/account/dist/testing/index.js';
import { createPassportAccounts } from '../../packages/account/dist/index.js';
import { webauthnPasskey } from '../../packages/adapter-webauthn/dist/index.js';
import { recipeJubjubAuthoriser, recipeDeviceKeyring } from '../../packages/keys/dist/index.js';
import * as binding from '../../packages/contract/generated/acc-s3r1.1/index.js';
import { AccSimulator } from '../../scripts/qualification/acc-simulator.mjs';
import { softwareAuthenticator, RP, ORIGIN } from './software-authenticator.mjs';

/** @param {'p256'|'jubjub'} arm @param {'results'|'enabled'} atCreate */
export function creationWorld(arm, atCreate) {
  /** @type {import('../../packages/account/dist/ports/index.js').PassportPorts['onAccountCreated']} */ let onCreated;
  const auth = softwareAuthenticator({ atCreate });
  /** @type {string[]} */ const purposes = [];
  const adapter = webauthnPasskey({
    rpId: RP,
    origin: ORIGIN,
    credentials: auth.container,
    registrationProfile: arm === 'jubjub' ? 'jubjub-prf' : 'p256',
    beforeCeremony: ({ purpose }) => {
      purposes.push(purpose);
    },
  });
  const sim = new AccSimulator(binding);
  /** @type {import('../../packages/account/dist/ports/index.js').AccountHint|undefined} */ let hint;
  /** @type {string[]} */ const effects = [];
  /** @type {import('../../packages/account/dist/ports/index.js').PassportPorts} */
  const ports = {
    onAccountCreated: async (account) => {
      await onCreated?.(account);
    },
    network: fakeNetwork({ bindingId: 'acc-s3r1.1' }),
    binding,
    credentials: adapter.credentials,
    authoriser:
      arm === 'p256' ? adapter.p256 : recipeJubjubAuthoriser(adapter.prf, binding.pureCircuits),
    viewingKey: recipeDeviceKeyring(adapter.prf),
    encryptionKey: {
      publicKey: async () => {
        throw Error('sealed keys required');
      },
    },
    directory: {
      get: async () => hint,
      put: async (_network, value) => {
        hint = value;
      },
    },
    chain: {
      readAccount: async () => {
        if (!sim.state) return undefined;
        const l = sim.ledger();
        const entries = [...l.devices];
        return {
          booted: l.booted,
          specVersion: Number(l.spec_version),
          authNonce: l.auth_nonce,
          deviceEpoch: l.device_epoch,
          encKey: l.enc_key,
          entryCount: entries.length,
          deviceEntries: entries,
          inboxEntries: [...l.inbox].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v),
          hasEntry: (value) => entries.some((e) => Buffer.from(e).equals(value)),
        };
      },
      call: async (
        /** @type {import('../../packages/account/dist/ports/index.js').CallRequest} */ request,
      ) => {
        effects.push(request.circuit);
        await sim.call(request.circuit, ...request.args);
        return { txHash: `generated-${effects.length}` };
      },
    },
    deployer: {
      deploy: async (request) => {
        assert.equal(sim.state, undefined);
        assert.equal(request.firstArm, arm);
        const init = await sim.contract.initialState(
          createConstructorContext({}, sim.coin),
          request.boot,
          request.encKey,
          sim.recovery.pk,
          new Uint8Array(64),
          60n,
        );
        sim.state = init.currentContractState.data;
        effects.push('deploy');
        return { address: sim.address, txIds: ['generated-deploy'] };
      },
    },
    random: (length) => crypto.getRandomValues(new Uint8Array(length)),
  };
  return {
    auth,
    adapter,
    sim,
    purposes,
    effects,
    ports,
    api: () => createPassportAccounts(ports),
    hint: () => hint,
    onCreated: (/** @type {NonNullable<typeof onCreated>} */ callback) => {
      onCreated = callback;
    },
  };
}
