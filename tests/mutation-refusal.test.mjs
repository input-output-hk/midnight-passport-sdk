import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDurablePassportMutations, mutationDigest } from '../packages/account/dist/index.js';
import { createFakePorts } from '../packages/account/dist/testing/index.js';
import { recipeDeviceKeyring } from '../packages/keys/dist/index.js';
const id = '23'.repeat(16),
  pins = {
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
    scheme: /** @type {const} */ ('p256-webauthn'),
  };
const intent = {
  kind: /** @type {const} */ ('create'),
  userName: 'synthetic',
  retireAuthority: true,
};
const input = {
  boot: new Uint8Array(32),
  encKey: new Uint8Array(32).fill(9),
  retireAuthority: true,
  firstArm: 'p256',
};
const digest = mutationDigest(input),
  effect = { key: `${id}:0`, kind: /** @type {const} */ ('deploy'), digest, input };
const document = () => ({
  version: /** @type {const} */ (1),
  id,
  revision: 2,
  pins,
  intent,
  randomSeed: new Uint8Array(32).fill(8),
  phase: /** @type {const} */ ('pending'),
  entries: [{ name: 'deploy', digest, phase: /** @type {const} */ ('running'), effect }],
});
/** @param {any} outcome @param {any} [doc] */
function fixture(outcome, doc = document()) {
  const fake = createFakePorts();
  let approvals = 0,
    writes = 0;
  const source = {
    withSession: async (/** @type {()=>Promise<any>} */ work) => work(),
    deriveSecret: async () => new Uint8Array(32).fill(7),
    deviceSecret: async () => new Uint8Array(32).fill(7),
  };
  const ports = {
    ...fake,
    network: { ...fake.network, ...pins },
    viewingKey: recipeDeviceKeyring(source),
  };
  const api = createDurablePassportMutations({
    ports,
    journal: {
      read: async () => doc,
      compareAndSwap: async () => {
        writes++;
        return false;
      },
    },
    consent: {
      approve: async () => {
        approvals++;
      },
    },
    outcomes: { reconcile: async () => outcome },
  });
  return { api, fake, counts: () => ({ approvals, writes }) };
}
for (const [label, outcome] of [
  ['unknown', { kind: 'unknown' }],
  ['wrong digest', { kind: 'not-submitted', digest: '00'.repeat(32), fenced: true }],
  ['unfenced earlier sender', { kind: 'not-submitted', digest, fenced: false }],
  [
    'incomplete confirmation',
    { kind: 'confirmed', digest, result: { address: 'ab'.repeat(32), txIds: [] } },
  ],
])
  test(`restart refuses ${label} before writes or a new deployment`, async () => {
    const f = fixture(outcome);
    await assert.rejects(f.api.resume({ id }), { code: 'MutationUnsettled' });
    assert.equal(f.fake.ledger.size, 0);
    assert.deepEqual(f.counts(), { approvals: 1, writes: 0 });
  });
test('original lock choice and pins cannot be changed during resume', async () => {
  const f = fixture({ kind: 'unknown' });
  await assert.rejects(f.api.run({ ...intent, retireAuthority: false }, { id }), {
    code: 'MutationUnsettled',
  });
  assert.deepEqual(f.counts(), { approvals: 0, writes: 0 });
  const other = fixture(
    { kind: 'unknown' },
    { ...document(), pins: { ...pins, networkId: 'preprod' } },
  );
  await assert.rejects(other.api.resume({ id }), { code: 'MutationUnsettled' });
  assert.equal(other.counts().approvals, 0);
});
test('failed initial journal CAS stops before any key generation or chain deployment', async () => {
  const f = fixture({ kind: 'unknown' }, undefined);
  // fixture's default supplies an existing record, so replace it explicitly with null.
  const fresh = fixture({ kind: 'unknown' }, null);
  await assert.rejects(fresh.api.run(intent, { id }), { code: 'MutationUnsettled' });
  assert.equal(fresh.fake.ledger.size, 0);
  assert.equal(fresh.counts().writes, 1);
  assert.equal(f.fake.ledger.size, 0);
});
