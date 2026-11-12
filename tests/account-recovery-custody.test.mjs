import assert from 'node:assert/strict';
import { test } from 'node:test';
import { x25519 } from '@noble/curves/ed25519.js';
import {
  createRecoveryGuardianCollector,
  stageRecoveryViewingKey,
} from '../packages/account/dist/recovery.js';

const session = Object.freeze({
  account: '11'.repeat(32),
  networkId: 'undeployed',
  bindingId: 'candidate-fixture',
  sessionId: '22'.repeat(32),
});
const roster = { indices: [1, 2, 3], threshold: 2 };
const assertCurrent = async () => {};

test('guardian collection rejects swapped and stale responses and erases owned buffers', async () => {
  const raw = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2), new Uint8Array(32).fill(3)];
  const collect = createRecoveryGuardianCollector({
    async requestShare(request) {
      const share = raw[request.index - 1];
      assert.ok(share);
      if (request.index === 2) return { ...request, index: 1, share };
      if (request.index === 3) return { ...request, sessionId: 'aa'.repeat(32), share };
      return { ...request, share };
    },
  });
  await assert.rejects(
    collect(session, roster, assertCurrent, async () => assert.fail()),
    {
      code: 'MutationUnsettled',
    },
  );
  assert.ok(raw.every((share) => share.every((byte) => byte === 0)));
  await assert.rejects(
    collect(session, { indices: [1, 1], threshold: 2 }, assertCurrent, async () => assert.fail()),
    /Invalid guardian roster/,
  );
  await assert.rejects(
    collect(session, { indices: [1], threshold: 2 }, assertCurrent, async () => assert.fail()),
    /Invalid guardian roster/,
  );
});

test('guardian collection excludes a concurrent attempt and cancellation clears partial shares', async () => {
  const controller = new AbortController();
  const raw = new Uint8Array(32).fill(1);
  /** @type {() => void} */
  let release = () => {};
  const collect = createRecoveryGuardianCollector({
    async requestShare(request) {
      await new Promise((resolve) => {
        release = () => resolve(undefined);
      });
      return { ...request, share: raw };
    },
  });
  const pending = collect(
    session,
    roster,
    assertCurrent,
    async () => assert.fail(),
    controller.signal,
  );
  await Promise.resolve();
  await assert.rejects(
    collect(session, roster, assertCurrent, async () => assert.fail()),
    {
      code: 'MutationUnsettled',
    },
  );
  controller.abort();
  release();
  await assert.rejects(pending, { code: 'Aborted' });
  assert.ok(raw.every((byte) => byte === 0));
});

test('guardian collection rechecks the session before use and clears the callback share copies', async () => {
  let currentReads = 0;
  /** @type {readonly import('../packages/account/dist/recovery.js').IndexedRecoveryShare[]} */
  let borrowed = [];
  const collect = createRecoveryGuardianCollector({
    async requestShare(request) {
      if (request.index === 2) return undefined;
      return { ...request, share: new Uint8Array(32).fill(request.index) };
    },
  });
  assert.equal(
    await collect(
      session,
      roster,
      async () => {
        currentReads++;
      },
      async (shares) => {
        assert.deepEqual(
          shares.map(({ index, share }) => [index, share[0]]),
          [
            [1, 1],
            [3, 3],
          ],
        );
        borrowed = shares;
        return 'restored';
      },
    ),
    'restored',
  );
  assert.equal(currentReads, 2);
  assert.ok(borrowed.every(({ share }) => share.every((byte) => byte === 0)));
  currentReads = 0;
  await assert.rejects(
    collect(
      session,
      roster,
      async () => {
        if (++currentReads === 2) throw new Error('session changed');
      },
      async () => assert.fail(),
    ),
    /session changed/,
  );
});

test('viewing continuity requires the original X25519 key and matching successor read-back', async () => {
  const original = new Uint8Array(32).fill(7);
  const target = {
    ...session,
    successorEntry: '33'.repeat(32),
    viewingPublicKey: Buffer.from(x25519.getPublicKey(original)).toString('hex'),
  };
  const input = Uint8Array.from(original);
  const readBack = Uint8Array.from(original);
  let reads = 0;
  await stageRecoveryViewingKey(
    target,
    input,
    {
      derivePublicKey: x25519.getPublicKey,
      async stageAndReadBack(bound, key) {
        assert.deepEqual(bound, target);
        assert.deepEqual(key, original);
        return readBack;
      },
    },
    async () => {
      reads++;
    },
  );
  assert.equal(reads, 2);
  assert.ok([...input, ...readBack].every((byte) => byte === 0));
  await assert.rejects(
    stageRecoveryViewingKey(
      target,
      new Uint8Array(32).fill(8),
      {
        derivePublicKey: x25519.getPublicKey,
        async stageAndReadBack() {
          return assert.fail('mismatched key reached custody');
        },
      },
      assertCurrent,
    ),
    { code: 'EncryptionKeyMismatch' },
  );
  const wrong = new Uint8Array(32).fill(8);
  await assert.rejects(
    stageRecoveryViewingKey(
      target,
      Uint8Array.from(original),
      {
        derivePublicKey: x25519.getPublicKey,
        async stageAndReadBack() {
          return wrong;
        },
      },
      assertCurrent,
    ),
    { code: 'EncryptionKeyMismatch' },
  );
  assert.ok(wrong.every((byte) => byte === 0));
});
