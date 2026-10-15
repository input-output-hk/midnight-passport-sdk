import assert from 'node:assert/strict';
import { test } from 'node:test';
import { x25519 } from '@noble/curves/ed25519.js';
import { openGrantView } from '../packages/keys/dist/index.js';
import { sealGrantView } from '../packages/keys/dist/grant-view-seal.js';

test('a read grantee opens only the viewing secret sealed to its account and grant', async () => {
  const readSecret = new Uint8Array(32).fill(7);
  const accountSecret = new Uint8Array(32).fill(9);
  const request = {
    grantId: 'ab'.repeat(32),
    account: 'cd'.repeat(32),
    readPublicKey: Buffer.from(x25519.getPublicKey(readSecret)).toString('hex'),
  };
  const seal = await sealGrantView(accountSecret, request);
  const expectedEncKey = x25519.getPublicKey(accountSecret);
  const opening = { ...request, seal, expectedEncKey };
  assert.deepEqual(await openGrantView(readSecret, opening), accountSecret);
  assert.equal(await openGrantView(new Uint8Array(32).fill(8), opening), null);
  assert.equal(await openGrantView(readSecret, { ...opening, grantId: 'ac'.repeat(32) }), null);
  assert.equal(await openGrantView(readSecret, { ...opening, account: 'ce'.repeat(32) }), null);
  assert.equal(
    await openGrantView(readSecret, {
      ...opening,
      expectedEncKey: x25519.getPublicKey(new Uint8Array(32).fill(8)),
    }),
    null,
  );
  const changed = seal.slice();
  changed[70] = (changed[70] ?? 0) ^ 1;
  assert.equal(await openGrantView(readSecret, { ...opening, seal: changed }), null);
  assert.equal(await openGrantView(readSecret, { ...opening, seal: seal.subarray(0, 93) }), null);
  assert.equal(
    await openGrantView(readSecret, { ...opening, seal: Uint8Array.of(2, ...seal.subarray(1)) }),
    null,
  );
  await assert.rejects(openGrantView(new Uint8Array(31), opening), /read secret/);
});
