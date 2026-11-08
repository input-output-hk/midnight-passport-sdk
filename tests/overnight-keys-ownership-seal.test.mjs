import assert from 'node:assert/strict';
import { test } from 'node:test';
import { x25519 } from '@noble/curves/ed25519.js';
import { openGrantView } from '../packages/keys/dist/index.js';
import { sealGrantView } from '../packages/keys/dist/grant-view-seal.js';
import { account } from './fixtures/overnight-keys-ownership-fixture.mjs';

test('openGrantView checks the 94-byte bound before copying oversized ciphertext', async () => {
  const readSecret = Buffer.alloc(32, 7),
    oversized = Buffer.alloc(1024 * 1024);
  const original = globalThis.Uint8Array;
  let copies = 0;
  const from = original.from;
  globalThis.Uint8Array = new Proxy(original, {
    construct(target, args, receiver) {
      if (args[0] === oversized) copies++;
      return Reflect.construct(target, args, receiver);
    },
  });
  original.from = new Proxy(from, {
    apply(target, receiver, args) {
      if (args[0] === oversized) copies++;
      return Reflect.apply(target, receiver, args);
    },
  });
  try {
    assert.equal(
      await openGrantView(readSecret, {
        grantId: 'cd'.repeat(32),
        account,
        seal: oversized,
        expectedEncKey: Buffer.alloc(32, 1),
      }),
      null,
    );
    assert.equal(copies, 0);
  } finally {
    original.from = from;
    globalThis.Uint8Array = original;
    readSecret.fill(0);
    oversized.fill(0);
  }
});

test('openGrantView accepts Buffer wire bytes without clearing caller inputs and authenticates exact context', async () => {
  const readSecret = Buffer.alloc(32, 7),
    accountSecret = Buffer.alloc(32, 9);
  const expectedEncKey = Buffer.from(x25519.getPublicKey(accountSecret));
  const seal = Buffer.from(
    await sealGrantView(accountSecret, {
      grantId: 'cd'.repeat(32),
      account,
      readPublicKey: Buffer.from(x25519.getPublicKey(readSecret)).toString('hex'),
    }),
  );
  try {
    const opened = await openGrantView(readSecret, {
      grantId: 'cd'.repeat(32),
      account,
      seal,
      expectedEncKey,
    });
    try {
      assert.deepEqual(opened, new Uint8Array(accountSecret));
    } finally {
      opened?.fill(0);
    }
    assert.equal(
      await openGrantView(readSecret, { grantId: 'ef'.repeat(32), account, seal, expectedEncKey }),
      null,
    );
    assert.ok(readSecret.every((v) => v === 7));
    assert.ok(accountSecret.every((v) => v === 9));
    assert.equal(seal.length, 94);
    assert.ok(seal.some((v) => v !== 0));
  } finally {
    readSecret.fill(0);
    accountSecret.fill(0);
  }
});

for (const length of [0, 93, 95]) {
  test(`openGrantView returns null for ${length}-byte malformed seals`, async () => {
    const secret = Buffer.alloc(32, 7);
    try {
      assert.equal(
        await openGrantView(secret, {
          grantId: 'cd'.repeat(32),
          account,
          seal: Buffer.alloc(length),
          expectedEncKey: Buffer.alloc(32),
        }),
        null,
      );
    } finally {
      secret.fill(0);
    }
  });
}

test('openGrantView uses the intrinsic expected-key size before copying a shadowed oversized array', async () => {
  const expectedEncKey = new Uint8Array(1024 * 1024);
  Object.defineProperty(expectedEncKey, 'length', { value: 32 });
  const original = globalThis.Uint8Array;
  let copies = 0;
  globalThis.Uint8Array = new Proxy(original, {
    construct(target, args, receiver) {
      if (args[0] === expectedEncKey) copies++;
      return Reflect.construct(target, args, receiver);
    },
  });
  try {
    await assert.rejects(
      openGrantView(Buffer.alloc(32, 7), {
        grantId: 'cd'.repeat(32),
        account,
        seal: Buffer.alloc(94),
        expectedEncKey,
      }),
      /live ACC enc_key must be 32 bytes/,
    );
    assert.equal(copies, 0);
  } finally {
    globalThis.Uint8Array = original;
  }
});
