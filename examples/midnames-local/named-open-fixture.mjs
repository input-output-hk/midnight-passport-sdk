import assert from 'node:assert/strict';
import { createPassportAccounts } from '../../packages/account/dist/index.js';
import { resolvePassportName } from '../../packages/account/dist/names.js';
import { createHostedAccChain } from '../../packages/adapter-midnight-js/dist/index.js';
import { resolveBinding } from '../../packages/contract/dist/index.js';
import * as sdkBinding from '../../packages/contract/generated/acc-s3r1.1/index.js';
import {
  createSoftwareIdentity,
  softwareParticipant,
} from '../../scripts/qualification/identities.mjs';

const bindingId = 'acc-s3r1.1';
const networkId = 'undeployed';
const pin = resolveBinding(bindingId);
const network = {
  bindingId,
  networkId,
  manifestSha256: pin.manifestSha256,
  nodeUrl: process.env.MN_NODE_URL,
  indexerUrl: process.env.MN_INDEXER_URL,
  indexerWsUrl: process.env.MN_INDEXER_WS_URL,
  artefactUrl: '',
};
const refuse = async () => {
  throw new Error('Unexpected operation during named account qualification.');
};

export async function namedOpenOwner({
  arm,
  acc,
  providers,
  compiledContract,
  contracts,
  wave,
  transactions,
}) {
  const identity = await createSoftwareIdentity();
  const participant = softwareParticipant(identity, arm);
  const privateStateId = 'midnames-authorized-open';
  let address;
  const chainOptions = {
    network,
    binding: { ...pin, id: bindingId },
    async readLedger(target) {
      assert.equal(target, address);
      const state = await providers.publicDataProvider.queryContractState(target);
      return state ? acc.ledger(state.data) : undefined;
    },
  };
  const chain = createHostedAccChain({
    ...chainOptions,
    async connectHandle(target) {
      assert.equal(target, address);
      return {
        callTx: new Proxy(
          {},
          {
            get:
              (_object, circuitId) =>
              async (...args) => {
                await providers.privateStateProvider.setContractAddress(target);
                return contracts.submitCallTx(providers, {
                  compiledContract,
                  contractAddress: target,
                  circuitId,
                  privateStateId,
                  args,
                });
              },
          },
        ),
      };
    },
  });
  function ports(owner, options) {
    return {
      network,
      binding: sdkBinding,
      ...options,
      authoriser: owner.authoriser,
      viewingKey: owner.keyring,
      encryptionKey: { publicKey: refuse },
      holdings: { selectHeldEntries: async () => [] },
    };
  }
  let hint;
  try {
    const created = await createPassportAccounts(
      ports(participant, {
        chain,
        credentials: participant.credentials,
        directory: {
          get: async () => hint,
          put: async (_network, next) => {
            hint = next;
          },
        },
        deployer: {
          async deploy(request) {
            const first = transactions.length;
            address = await wave.deployAccountInWaves(providers, compiledContract, {
              firstArm: arm,
              privateStateId,
              initialPrivateState: {},
              retireAuthority: true,
              args: [
                request.boot,
                request.encKey,
                acc.pureCircuits.compute_public_point_with_jubjub(13n),
                new Uint8Array(64),
                60n,
              ],
            });
            return { address, txIds: transactions.slice(first).map(({ id }) => id) };
          },
        },
      }),
    ).createAccount({ userName: 'named-open-fixture', retireAuthority: true });
    assert.equal(created.address, address);
  } catch (error) {
    identity.seed.fill(0);
    identity.device.fill(0);
    throw error;
  }

  return {
    address,
    close() {
      identity.seed.fill(0);
      identity.device.fill(0);
    },
    async qualify(names) {
      let identifications = 0;
      let writes = 0;
      const readOnly = createHostedAccChain({ ...chainOptions, connectHandle: refuse });
      const cold = (owner) =>
        createPassportAccounts(
          ports(owner, {
            chain: readOnly,
            credentials: {
              create: refuse,
              async identify() {
                identifications++;
                return owner.credentials.identify();
              },
            },
            directory: { get: async () => undefined, put: async () => {} },
            deployer: { deploy: refuse },
            records: {
              read: async () => undefined,
              exists: async () => false,
              write: async () => {
                writes++;
              },
            },
          }),
        );
      const lookup = (name) => resolvePassportName(names, { name, networkId });
      assert.equal(await lookup('unknown.night'), undefined);
      assert.equal(identifications, 0);
      const target = await lookup('alice.night');
      assert.equal(target?.accountAddress, address);
      const unrelated = await createSoftwareIdentity();
      try {
        await assert.rejects(
          cold(softwareParticipant(unrelated, arm)).openAccountAt(target.accountAddress),
          { code: arm === 'p256' ? 'AccountNotFound' : 'NotAuthorised' },
        );
      } finally {
        unrelated.seed.fill(0);
        unrelated.device.fill(0);
      }
      assert.equal(writes, 0);
      const opened = await cold(participant).openAccountAt(target.accountAddress);
      assert.equal(opened.address, address);
      assert.equal(opened.networkId, networkId);
      assert.equal(opened.bindingId, bindingId);
      const state = await opened.state();
      assert.ok(state.booted);
      assert.equal(state.entryCount, 1);
      assert.deepEqual(await opened.readShieldedHoldings(), []);
      assert.equal(identifications, 2);
      assert.equal(writes, 1);
      return {
        arm,
        accountAddress: address,
        credentialChecks: identifications,
        unknownNameCredentialChecks: 0,
        unrelatedCredentialRefused: true,
        sealedReaderOpened: true,
      };
    },
  };
}
