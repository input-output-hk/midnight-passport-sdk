import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { createMidnightGrantSource } from '../packages/adapter-midnight-js/dist/index.js';

const account = 'ab'.repeat(32);
const readId = '01'.repeat(32);
const missingId = '02'.repeat(32);
const spendId = '03'.repeat(32);
const revokedId = '04'.repeat(32);
const readKey = '05'.repeat(32);
const hash = (/** @type {string} */ value) =>
  createHash('sha256').update(Buffer.from(value, 'hex')).digest();
/** @param {boolean} active @param {boolean} read @param {Uint8Array} [readHash] */
const record = (active, read, readHash = Buffer.alloc(32)) => ({
  active,
  scope: { read, read_pk_hash: readHash },
});

function fixture() {
  let nonce = 7n;
  let generation = 2n;
  /** @type {Array<[Uint8Array, ReturnType<typeof record>]>} */
  let entries = [
    [Buffer.from(readId, 'hex'), record(true, true, hash(readKey))],
    [Buffer.from(missingId, 'hex'), record(true, true, hash('06'.repeat(32)))],
    [Buffer.from(spendId, 'hex'), record(true, false)],
    [Buffer.from(revokedId, 'hex'), record(false, true)],
  ];
  /** @type {string[]} */
  const queries = [];
  /** @type {string[]} */
  const openings = [];
  let present = true;
  const source = createMidnightGrantSource({
    network: {
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      indexerUrl: 'http://localhost:8088/api/v1/graphql',
      indexerWsUrl: 'ws://localhost:8088/api/v1/graphql/ws',
    },
    binding: {
      ledger: () => ({
        auth_nonce: nonce,
        grant_generation: generation,
        grants: {
          size: () => BigInt(entries.length),
          [Symbol.iterator]: () => entries[Symbol.iterator](),
        },
      }),
    },
    publicDataProvider: /** @type {any} */ ({
      queryContractState: async (/** @type {string} */ address) => {
        queries.push(address);
        return present ? { data: {} } : undefined;
      },
    }),
    openings: {
      readReadPublicKey: async (address, id) => {
        assert.equal(address, account);
        openings.push(id);
        return id === readId ? readKey : '07'.repeat(32);
      },
    },
  });
  return {
    source,
    queries,
    openings,
    setNonce: (/** @type {bigint} */ value) => (nonce = value),
    setGeneration: (/** @type {bigint} */ value) => (generation = value),
    setEntries: (/** @type {typeof entries} */ value) => (entries = value),
    setPresent: (/** @type {boolean} */ value) => (present = value),
  };
}

test('one ledger snapshot supplies active grants and authenticates only live read openings', async () => {
  const { source, queries, openings, setNonce } = fixture();
  assert.deepEqual(await source.readActiveGrantIds(account), [readId, missingId, spendId]);
  assert.deepEqual(await source.readActiveGrantSnapshot(account), {
    authNonce: 7n,
    ids: [readId, missingId, spendId],
  });
  assert.deepEqual(await source.readGrantRoster(account), {
    authNonce: 7n,
    generation: 2n,
    entries: [
      { id: readId, active: true, read: true },
      { id: missingId, active: true, read: true },
      { id: spendId, active: true, read: false },
      { id: revokedId, active: false, read: true },
    ],
  });
  assert.deepEqual(await source.readGrant(account, spendId), {
    active: true,
    read: false,
    authNonce: 7n,
  });
  assert.deepEqual(await source.readGrant(account, revokedId), {
    active: false,
    read: true,
    authNonce: 7n,
  });
  assert.equal(await source.readGrant(account, 'ff'.repeat(32)), undefined);
  assert.deepEqual(await source.readActiveReadGrantTargets(account), {
    authNonce: 7n,
    targets: [{ grantId: readId, readPublicKey: readKey }, { grantId: missingId }],
  });
  assert.deepEqual(openings, [readId, missingId]);
  assert.deepEqual(queries, Array(7).fill(account));
  setNonce(8n);
  assert.equal((await source.readActiveReadGrantTargets(account)).authNonce, 8n);
});

test('missing accounts and malformed grant maps fail closed', async () => {
  const { source, setEntries, setPresent, setGeneration } = fixture();
  setPresent(false);
  await assert.rejects(source.readActiveGrantIds(account), { code: 'AccountNotFound' });
  setPresent(true);
  setEntries([[Buffer.alloc(31), record(true, true)]]);
  await assert.rejects(source.readActiveGrantIds(account), { code: 'BindingUnsupported' });
  setEntries([
    [Buffer.from(readId, 'hex'), record(true, true)],
    [Buffer.from(readId, 'hex'), record(true, true)],
  ]);
  await assert.rejects(source.readActiveGrantIds(account), { code: 'BindingUnsupported' });
  setGeneration(1n << 32n);
  await assert.rejects(source.readGrantRoster(account), { code: 'BindingUnsupported' });
});
