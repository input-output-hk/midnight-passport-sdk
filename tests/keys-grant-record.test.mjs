import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { openGrantRecord, sealGrantRecord } from '../packages/keys/dist/grant-record.js';

const account = 'aa'.repeat(32);
const reader = new Uint8Array(32).fill(7);
/** @type {import('../packages/account/dist/ports/index.js').GrantRecordPart[]} */
const parts = [
  {
    part: 'grant',
    grantId: 'ab'.repeat(32),
    slot: 9,
    scopeSalt: 'bc'.repeat(32),
    granteePublicKey: 'cd'.repeat(32),
    readPublicKey: 'de'.repeat(32),
  },
  {
    part: 'object',
    grantId: 'ab'.repeat(32),
    object: {
      color: 'ef'.repeat(32),
      recipient: { kind: 'contract-address', value: '01'.repeat(32) },
      maxCoinValue: ((1n << 127n) + 13n).toString(),
    },
  },
  {
    part: 'view',
    grantId: 'ab'.repeat(32),
    encKeyPrefix: '012345',
    seal: '23'.repeat(94),
  },
];

test('all grant record kinds match Lace layout and open for the reader on this account', async () => {
  for (const part of parts) {
    const entry = await sealGrantRecord(reader, account, part);
    assert.equal(entry.length, 192);
    assert.deepEqual([...entry.subarray(0, 2)], [0xd3, 1]);
    assert.deepEqual(await openGrantRecord(reader, account, entry), part);

    // Verify the recipient tag from independent MIP-0015-style HKDF bits and SHA-256.
    const material = await crypto.subtle.importKey('raw', reader, 'HKDF', false, [
      'deriveBits',
      'deriveKey',
    ]);
    const info = Buffer.concat([
      new TextEncoder().encode('lace:passport:grant-record-tag:v1'),
      Buffer.from(account, 'hex'),
    ]);
    const tagKey = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info },
        material,
        256,
      ),
    );
    assert.deepEqual(
      entry.subarray(2, 34),
      sha256(Buffer.concat([tagKey, entry.subarray(34, 46)])),
    );
    const recordKey = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(),
        info: Buffer.concat([
          new TextEncoder().encode('lace:passport:grant-record:v1'),
          Buffer.from(account, 'hex'),
        ]),
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt'],
    );
    const plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: entry.subarray(34, 46), additionalData: entry.subarray(0, 46) },
        recordKey,
        Buffer.concat([entry.subarray(62), entry.subarray(46, 62)]),
      ),
    );
    assert.equal(plain.length, 130);
    assert.equal(Buffer.from(plain.subarray(1, 33)).toString('hex'), part.grantId);
    tagKey.fill(0);
    plain.fill(0);
  }
});

test('grant records reject wrong account, reader, tampering and invalid fields', async () => {
  const grant = parts[0];
  const object = parts[1];
  assert.ok(grant?.part === 'grant' && object?.part === 'object');
  const entry = await sealGrantRecord(reader, account, grant);
  assert.equal(await openGrantRecord(reader, 'bb'.repeat(32), entry), null);
  assert.equal(await openGrantRecord(new Uint8Array(32).fill(8), account, entry), null);
  for (const offset of [0, 1, 2, 34, 46, 62, 191]) {
    const changed = entry.slice();
    changed[offset] = (changed[offset] ?? 0) ^ 1;
    assert.equal(await openGrantRecord(reader, account, changed), null, `offset ${offset}`);
  }
  assert.equal(await openGrantRecord(reader, account, entry.subarray(0, 191)), null);
  await assert.rejects(sealGrantRecord(reader, account, { ...grant, slot: 256 }), /unsigned byte/);
  await assert.rejects(
    sealGrantRecord(reader, account, {
      ...object,
      object: { ...object.object, maxCoinValue: (1n << 128n).toString() },
    }),
    /uint128/,
  );
});
