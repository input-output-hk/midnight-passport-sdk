import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertNoSecretMaterial } from '../scripts/qualification/secret-scan.mjs';

const secret = '7e'.repeat(32),
  bytes = Buffer.from(secret, 'hex');
test('qualification guard finds declared string and binary secret representations', () => {
  const padded = Buffer.concat([Buffer.from([1, 2]), bytes, Buffer.from([3])]);
  const shared = new SharedArrayBuffer(32);
  new Uint8Array(shared).set(bytes);
  for (const value of [
    secret,
    secret.toUpperCase(),
    bytes.toString('base64'),
    bytes.toString('base64').replace(/=+$/, ''),
    bytes.toString('base64url'),
    [...bytes],
    new Uint8Array(bytes),
    new Uint8Array(bytes).buffer,
    shared,
    new DataView(padded.buffer, padded.byteOffset + 2, 32),
    new Uint16Array(new Uint8Array(bytes).buffer),
    Buffer.from(bytes.toString('base64')),
  ]) {
    assert.throws(
      () => assertNoSecretMaterial({ nested: [value] }, [secret]),
      /Secret material detected/,
    );
  }
  assert.throws(
    () => assertNoSecretMaterial({ [secret]: 0 }, [secret]),
    /Secret material detected/,
  );
});
test('qualification guard permits supported public payloads and refuses malformed/unbounded input', () => {
  assert.doesNotThrow(() =>
    assertNoSecretMaterial(
      {
        origin: 'https://dapp.example',
        point: { x: 7n, y: 8n },
        entry: new Uint8Array(192).fill(5),
        optional: undefined,
      },
      [secret],
    ),
  );
  const cyclic = {};
  Object.assign(cyclic, { cycle: cyclic });
  for (const value of [cyclic, new Date(), () => {}, 'x'.repeat(2 * 1024 * 1024 + 1)])
    assert.throws(() => assertNoSecretMaterial(value, [secret]));
  assert.throws(() => assertNoSecretMaterial({}, ['malformed']), /Invalid secret-scan input/);
  try {
    assertNoSecretMaterial(bytes, [secret]);
  } catch (error) {
    assert.ok(!String(error).includes(secret));
  }
});

test('declared secrets cannot escape as big-endian or little-endian integers and decimal strings', () => {
  const asymmetric = '01' + '23'.repeat(30) + '45';
  for (const hex of [asymmetric, Buffer.from(asymmetric, 'hex').reverse().toString('hex')]) {
    const integer = BigInt('0x' + hex);
    for (const value of [integer, integer.toString()])
      assert.throws(
        () => assertNoSecretMaterial({ scalar: value }, [asymmetric]),
        /Secret material detected/,
      );
  }
});

test('base64 envelopes are scanned at every byte offset with both alphabets and padding choices', () => {
  const asymmetric = '7f' + 'e3'.repeat(30) + 'a5';
  for (const offset of [0, 1, 2, 3, 4, 5]) {
    const envelope = Buffer.concat([
      Buffer.alloc(offset, 0xfb),
      Buffer.from(asymmetric, 'hex'),
      Buffer.from([0xff, 0x00]),
    ]);
    for (const encoding of ['base64', 'base64url']) {
      const value = envelope.toString(/** @type {'base64'|'base64url'} */ (encoding));
      for (const text of [value, value.replace(/=+$/, '')])
        assert.throws(
          () => assertNoSecretMaterial({ encoded: text }, [asymmetric]),
          /Secret material detected/,
        );
    }
  }
});
