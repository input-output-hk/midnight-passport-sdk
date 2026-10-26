// Actual generated ACC execution and software signatures; no proving or native transport.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createConstructorContext } from '@midnight-ntwrk/compact-runtime';
import { x25519 } from '@noble/curves/ed25519.js';
import { jubjub } from '@noble/curves/misc.js';
import { createPassportAccounts, mutationDigest } from '../../packages/account/dist/index.js';
import { fakeNetwork } from '../../packages/account/dist/testing/index.js';
import { createMidnightGrantSource } from '../../packages/adapter-midnight-js/dist/index.js';
import * as binding from '../../packages/contract/generated/acc-s3r1.1/index.js';
import { AccSimulator } from '../../scripts/qualification/acc-simulator.mjs';
import {
  createSoftwareIdentity,
  softwareParticipant,
} from '../../scripts/qualification/identities.mjs';

/** @typedef {import('../../packages/account/dist/ports/index.js').PassportPorts} Ports */
/** @typedef {import('../../packages/adapter-midnight-js/dist/index.js').ReadGrantOpeningSource} Openings */
const hex = (/** @type {Uint8Array} */ value) => Buffer.from(value).toString('hex');

/** @param {'p256'|'jubjub'} arm */
export async function generatedGrantAccount(arm) {
  const sim = new AccSimulator(binding);
  const participants = {
    owner: softwareParticipant(await createSoftwareIdentity(), arm),
    survivor: softwareParticipant(await createSoftwareIdentity(), arm),
  };
  /** @type {string[]} */ const effects = [];
  /** @type {Map<string,import('../../packages/account/dist/jubjub-grant-issue.js').StagedJubjubGrant>} */
  const journal = new Map();
  const published = new Set();
  const network = fakeNetwork({ bindingId: 'acc-s3r1.1' });
  const chain = {
    async readAccount() {
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
        hasEntry: (/** @type {Uint8Array} */ entry) => entries.some((v) => hex(v) === hex(entry)),
      };
    },
    /** @param {import('../../packages/account/dist/ports/index.js').CallRequest} request */
    async call(request) {
      assert.equal(request.address, sim.address);
      effects.push(request.circuit);
      await sim.call(request.circuit, ...request.args);
      return { txHash: `generated-${effects.length}` };
    },
  };
  /** @param {Openings} openings */
  const grants = (openings) =>
    createMidnightGrantSource({
      network,
      binding,
      openings,
      publicDataProvider: /** @type {any} */ ({
        queryContractState: async () => ({ data: sim.state }),
      }),
    });
  const stagedOpenings = {
    readReadPublicKey: async (/** @type {string} */ _account, /** @type {string} */ id) =>
      journal.get(id)?.bookkeeping.readPublicKey,
  };
  const initialGrants = grants(stagedOpenings);
  /** @type {Set<string>} */ const profiles = new Set();
  let forbiddenJournalTouches = 0;
  /** @param {'owner'|'survivor'} role @param {string} name @param {boolean} [issuing] @returns {Promise<Ports>} */
  const profile = async (role, name, issuing = false) => {
    assert.ok(!profiles.has(name));
    profiles.add(name);
    const participant = participants[role];
    /** @type {import('../../packages/account/dist/ports/index.js').AccountRecord|undefined} */ let record;
    /** @type {import('../../packages/account/dist/ports/index.js').AccountHint|undefined} */ let hint;
    const forbidden = async () => {
      forbiddenJournalTouches++;
      throw new Error('Original journal is unavailable to a fresh profile.');
    };
    return {
      network,
      binding,
      chain,
      authoriser: participant.authoriser,
      credentials: participant.credentials,
      viewingKey: participant.keyring,
      encryptionKey: {
        publicKey: async () => {
          throw new Error('Sealed keys required.');
        },
      },
      holdings: { selectHeldEntries: async () => [] },
      readGrants: initialGrants,
      grants: initialGrants,
      grantCommitments: initialGrants,
      grantDetails: initialGrants,
      grantRoster: initialGrants,
      grantOrigin: 'localhost',
      records: {
        read: async () => record,
        exists: async () => record !== undefined,
        write: async (value) => {
          effects.push(`profile-record:${name}`);
          record = value;
        },
      },
      directory: {
        get: async () => hint,
        put: async (_network, value) => {
          effects.push(`profile-directory:${name}`);
          hint = value;
        },
      },
      deployer: {
        deploy: async (request) => {
          assert.equal(sim.state, undefined);
          const init = await sim.contract.initialState(
            createConstructorContext({}, sim.coin),
            request.boot,
            request.encKey,
            sim.recovery.pk,
            new Uint8Array(64),
            60n,
          );
          sim.state = init.currentContractState.data;
          effects.push('constructor');
          return { address: sim.address, txIds: ['generated-constructor'] };
        },
      },
      grantJournal: issuing
        ? {
            stage: async (opening) => {
              assert.ok(!journal.has(opening.bookkeeping.grantId));
              journal.set(opening.bookkeeping.grantId, opening);
            },
            load: async (_account, id) => journal.get(id),
            pending: async () => [...journal.keys()].filter((id) => !published.has(id)),
            markPublished: async (_account, id) => {
              published.add(id);
            },
          }
        : { stage: forbidden, load: forbidden, pending: forbidden, markPublished: forbidden },
      random: (length) => new Uint8Array(randomBytes(length)),
    };
  };
  const initial = await profile('owner', 'issuing-profile', true);
  const account = await createPassportAccounts(initial).createAccount({
    userName: 'generated-grant-owner',
    retireAuthority: true,
  });
  assert.equal(
    (await initial.records?.read())?.address,
    account.address,
    'Successful creation must persist the record needed by grant APIs.',
  );
  assert.ok(account.issueGrant && account.addDevice);
  /** @type {Array<{grantId:string,readSecret:Uint8Array}>} */ const grantees = [];
  for (const scalar of [11n, 13n]) {
    const readSecret = new Uint8Array(randomBytes(32));
    const result = await account.issueGrant({
      grantee: {
        scheme: 'jubjub-schnorr',
        publicKey: hex(
          jubjub.Point.fromAffine(
            binding.pureCircuits.compute_public_point_with_jubjub(scalar),
          ).toBytes(),
        ),
      },
      operations: ['withdraw-unshielded'],
      color: '34'.repeat(32),
      recipient: { kind: 'any' },
      maxCoinValue: '100',
      perCallCap: '10',
      cap: '100',
      expiresAt: null,
      read: true,
      rpId: 'localhost',
      readPublicKey: hex(x25519.getPublicKey(readSecret)),
    });
    assert.equal(result.status, 'active');
    grantees.push({ grantId: result.grantId, readSecret });
  }
  await account.addDevice(await participants.survivor.reader());
  const retained = mutationDigest([...journal]);
  return {
    sim,
    chain,
    grants,
    profile,
    grantees,
    effects,
    journal,
    participants,
    initial,
    account: account.address,
    origin: 'localhost',
    pure: binding.pureCircuits,
    heldCoins: /** @type {const} */ (0),
    effectCount: () => effects.length,
    assertRetained: async () => {
      assert.equal(mutationDigest([...journal]), retained);
      assert.equal(forbiddenJournalTouches, 0);
    },
    // This fast fixture has no value-bearing setup. Native qualification supplies one coin.
    assertHoldings: async () => {
      assert.equal(
        effects.some((name) => name.startsWith('deposit_')),
        false,
      );
    },
  };
}
