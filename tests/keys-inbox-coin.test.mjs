import assert from 'node:assert/strict';
import { test } from 'node:test';
import { x25519 } from '@noble/curves/ed25519.js';
import { openInboxCoin, sealInboxCoin } from '../packages/keys/dist/inbox-coin.js';

test('coin entry matches the Lace 192-byte layout and unsigned 128-bit value', async () => {
  const account = x25519.keygen();
  const coin = {
    nonce: new Uint8Array(32).fill(1),
    color: new Uint8Array(32).fill(2),
    value: (1n << 127n) + 123n,
  };
  const entry = await sealInboxCoin(account.publicKey, coin);
  assert.equal(entry.length, 192);
  assert.deepEqual([...entry.subarray(0, 2)], [1, 1]);
  assert.ok(entry.subarray(142).every((byte) => byte === 0));
  assert.deepEqual(await openInboxCoin(account.secretKey, entry), coin);

  // Decrypt the wire bytes independently using Lace's HKDF info and layout.
  const shared = x25519.getSharedSecret(account.secretKey, entry.subarray(2, 34));
  const imported = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(),
      info: new TextEncoder().encode('midnight:custody:inbox:v1'),
    },
    imported,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: entry.subarray(34, 46), additionalData: entry.subarray(0, 2) },
      key,
      Buffer.concat([entry.subarray(62, 142), entry.subarray(46, 62)]),
    ),
  );
  assert.deepEqual(plain.subarray(0, 32), coin.nonce);
  assert.deepEqual(plain.subarray(32, 64), coin.color);
  assert.equal(Buffer.from(plain.subarray(64)).toString('hex'), '8000000000000000000000000000007b');
  shared.fill(0);
  plain.fill(0);
  account.secretKey.fill(0);
});

test('coin entry refuses another reader, tampering and values outside uint128', async () => {
  const account = x25519.keygen();
  const other = x25519.keygen();
  const coin = { nonce: new Uint8Array(32), color: new Uint8Array(32), value: 0n };
  const entry = await sealInboxCoin(account.publicKey, coin);
  assert.equal(await openInboxCoin(other.secretKey, entry), null);
  for (const offset of [0, 1, 2, 34, 46, 62]) {
    const changed = entry.slice();
    changed[offset] = (changed[offset] ?? 0) ^ 1;
    assert.equal(await openInboxCoin(account.secretKey, changed), null, `offset ${offset}`);
  }
  assert.equal(await openInboxCoin(account.secretKey, entry.subarray(0, 191)), null);
  await assert.rejects(
    sealInboxCoin(account.publicKey, { ...coin, value: 1n << 128n }),
    /unsigned 128 bits/,
  );
  await assert.rejects(
    sealInboxCoin(account.publicKey, { ...coin, value: -1n }),
    /unsigned 128 bits/,
  );
  account.secretKey.fill(0);
  other.secretKey.fill(0);
});
