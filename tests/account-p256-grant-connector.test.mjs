import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jubjub } from '@noble/curves/misc.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { createPassportAccounts } from '../packages/account/dist/index.js';
import { createFakePorts } from '../packages/account/dist/testing/index.js';
import { recipeDeviceKeyring } from '../packages/keys/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

/** @param {Uint8Array} value */
const hex = (value) => Buffer.from(value).toString('hex');

test('P-256 account issue publishes sealed bookkeeping and recovery skips completed grants', async () => {
  const fake = createFakePorts({ binding: { pureCircuits } });
  /** @type {Map<string, import('../packages/account/dist/jubjub-grant-issue.js').StagedJubjubGrant>} */
  const staged = new Map();
  /** @type {string[]} */
  const active = [];
  /** @type {string[]} */
  const pending = [];
  const ports = {
    ...fake,
    network: { ...fake.network, bindingId: 'acc-s3r1.1' },
    viewingKey: recipeDeviceKeyring({
      withSession: (/** @type {() => Promise<any>} */ operation) => operation(),
      deriveSecret: async () => new Uint8Array(32).fill(9),
      deviceSecret: async () => new Uint8Array(32).fill(9),
    }),
    authoriser: {
      ...fake.authoriser,
      withKeySession: async (/** @type {() => Promise<any>} */ operation) => operation(),
    },
    grantOrigin: 'example.org',
    holdings: { selectHeldEntries: async () => [] },
    readGrants: {
      readActiveReadGrantTargets: async () => ({
        authNonce: [...fake.ledger.values()][0]?.authNonce ?? 0n,
        targets: [],
      }),
    },
    grants: {
      readActiveGrantIds: async () => active,
      readActiveGrantSnapshot: async () => ({
        authNonce: [...fake.ledger.values()][0]?.authNonce ?? 0n,
        ids: active,
      }),
    },
    grantJournal: {
      stage: async (
        /** @type {import('../packages/account/dist/jubjub-grant-issue.js').StagedJubjubGrant} */ opening,
      ) => {
        staged.set(opening.bookkeeping.grantId, opening);
        pending.push(opening.bookkeeping.grantId);
      },
      load: async (/** @type {string} */ _account, /** @type {string} */ id) => staged.get(id),
      pending: async () => pending,
      markPublished: async (/** @type {string} */ _account, /** @type {string} */ id) => {
        pending.splice(pending.indexOf(id), 1);
      },
    },
    chain: {
      ...fake.chain,
      /** @param {import('../packages/account/dist/ports/index.js').CallRequest} request */
      call: async (request) => {
        if (request.circuit !== 'issue_grant_with_p256') return fake.chain.call(request);
        const ledger = fake.ledger.get(request.address);
        assert.ok(ledger);
        const grantId = hex(/** @type {Uint8Array} */ (request.args[0]));
        assert.equal(staged.get(grantId)?.bookkeeping.grantId, grantId);
        const auth =
          /** @type {{pk: {x: bigint, y: bigint}, policy: {rp_id_hash: Uint8Array, origin: Uint8Array}, use_counter: bigint}} */ (
            request.args[18]
          );
        const self = { bytes: Buffer.from(request.address, 'hex') };
        const oldEntry = hex(
          pureCircuits.derive_device_entry_with_p256(
            self,
            { ...auth.pk, identity: false },
            auth.policy,
            ledger.deviceEpoch,
            auth.use_counter,
          ),
        );
        const newEntry = hex(
          pureCircuits.derive_device_entry_with_p256(
            self,
            { ...auth.pk, identity: false },
            auth.policy,
            ledger.deviceEpoch,
            auth.use_counter + 1n,
          ),
        );
        assert.ok(ledger.entries.delete(oldEntry));
        ledger.entries.add(newEntry);
        ledger.authNonce++;
        active.push(grantId);
        return { txHash: 'issue-tx' };
      },
    },
  };
  const account = await createPassportAccounts(ports).createAccount({
    userName: 'grant',
    retireAuthority: true,
  });
  const ledger = fake.ledger.get(account.address);
  assert.ok(ledger);
  ledger.specVersion = 3;
  assert.equal((await fake.records.read())?.address, account.address);
  assert.ok(account.issueGrant);
  const result = await account.issueGrant({
    grantee: { scheme: 'jubjub-schnorr', publicKey: hex(jubjub.Point.BASE.toBytes()) },
    operations: ['withdraw-unshielded'],
    color: '34'.repeat(32),
    recipient: { kind: 'any' },
    maxCoinValue: '100',
    perCallCap: '10',
    cap: '100',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });
  assert.equal(result.status, 'active');
  assert.equal(result.txHash, 'issue-tx');
  assert.equal(result.appendTxHashes.length, 2);
  assert.deepEqual(pending, []);
  const readResult = await account.issueGrant({
    grantee: { scheme: 'jubjub-schnorr', publicKey: hex(jubjub.Point.BASE.toBytes()) },
    operations: ['withdraw-unshielded'],
    read: true,
    rpId: 'example.org',
    readPublicKey: hex(x25519.getPublicKey(new Uint8Array(32).fill(7))),
    color: '34'.repeat(32),
    recipient: { kind: 'any' },
    maxCoinValue: '100',
    perCallCap: '10',
    cap: '100',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
  });
  assert.equal(readResult.status, 'active');
  assert.ok(readResult.rotation);
  assert.ok(readResult.sealedReadGrant);
  assert.equal(readResult.appendTxHashes.length, 3);
  assert.deepEqual(pending, []);
  assert.ok(account.recoverPendingGrants);
  assert.deepEqual(await account.recoverPendingGrants(), {
    published: [],
    unsettledGrantIds: [],
  });
});
