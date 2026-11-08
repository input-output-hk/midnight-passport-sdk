import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jubjub } from '@noble/curves/misc.js';
import { openGrantRecord, sealGrantRecord } from '../packages/keys/dist/grant-record.js';
import { verifyGrantBookkeepingCommitment } from '../packages/account/dist/index.js';

const account = 'ab'.repeat(32);
const reader = new Uint8Array(32).fill(7);
const U128_MAX = (1n << 128n) - 1n;
/** @param {string} value */
function objectPart(value) {
  return {
    part: /** @type {const} */ ('object'),
    grantId: 'cd'.repeat(32),
    object: {
      color: 'ef'.repeat(32),
      recipient: /** @type {const} */ ({ kind: 'any' }),
      maxCoinValue: value,
    },
  };
}

for (const value of ['0', '0001', U128_MAX.toString()]) {
  test(`record preserves bounded uint128 value ${value}`, async () => {
    const part = objectPart(value);
    const entry = await sealGrantRecord(reader, account, part);
    assert.deepEqual(await openGrantRecord(reader, account, entry), {
      ...part,
      object: { ...part.object, maxCoinValue: BigInt(value).toString() },
    });
  });
}

const invalid = [
  '',
  ' ',
  '+1',
  '-1',
  '0x10',
  '1\n',
  '1.5',
  '0'.repeat(40),
  '9'.repeat(100_000),
  (U128_MAX + 1n).toString(),
];
for (const [index, value] of invalid.entries()) {
  test(`invalid record bound ${index} refuses before key derivation`, async () => {
    // The invalid reader would produce a different error if derivation ran first.
    await assert.rejects(sealGrantRecord(new Uint8Array(0), account, objectPart(value)), /uint128/);
  });
}

test('sealing captures the public record before asynchronous key derivation', async () => {
  const part = objectPart('4');
  const expected = structuredClone(part);
  const pending = sealGrantRecord(reader, account, part);
  part.grantId = '99'.repeat(32);
  part.object.color = '88'.repeat(32);
  part.object.maxCoinValue = '1';
  const entry = await pending;
  assert.deepEqual(await openGrantRecord(reader, account, entry), expected);
});

for (const buffer of [false, true]) {
  test(`opening captures ${buffer ? 'Buffer' : 'Uint8Array'} envelope before derivation`, async () => {
    const part = objectPart('4');
    const encoded = await sealGrantRecord(reader, account, part);
    const entry = buffer ? Buffer.from(encoded) : encoded;
    const pending = openGrantRecord(reader, account, entry);
    entry.fill(0);
    assert.deepEqual(await pending, part);
  });
}

for (const [index, value] of invalid.entries()) {
  test(`invalid opening bound ${index} refuses before commitment helpers`, () => {
    let calls = 0;
    /** @type {import('../packages/account/dist/ports/index.js').GrantBookkeeping} */
    const bookkeeping = {
      grantId: 'cd'.repeat(32),
      slot: 0,
      scopeSalt: '12'.repeat(32),
      granteePublicKey: Buffer.from(jubjub.Point.BASE.toBytes()).toString('hex'),
      object: objectPart(value).object,
    };
    const live = {
      active: true,
      read: false,
      authNonce: 0n,
      objectCommit: new Uint8Array(32),
      readPkHash: new Uint8Array(32),
    };
    const pure = {
      derive_grant_id_with_jubjub: () => {
        calls++;
        return new Uint8Array(32);
      },
      derive_grant_object_commit: () => {
        calls++;
        return new Uint8Array(32);
      },
    };
    assert.throws(
      () => verifyGrantBookkeepingCommitment(account, 'example.org', bookkeeping, live, pure),
      { code: 'GrantScopeInvalid' },
    );
    assert.equal(calls, 0);
  });
}
