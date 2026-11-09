import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pureCircuits } from '#acc';
import { createRoutineKeys, type RoutineAccount } from '../src/routine-keys.js';
import { createRoutineReviews } from '../src/routine-review.js';

const material = () => ({
  root: new Uint8Array(32).fill(9),
  authoriser: new Uint8Array(32).fill(7),
});
function gate() {
  let release = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, wait };
}
async function fixture() {
  const account: RoutineAccount = {
    address: 'ab'.repeat(32),
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    credentialId: Uint8Array.of(1, 2, 3),
    scheme: 'jubjub-schnorr',
  };
  let clock = 1000;
  const requests: string[] = [];
  const outputs: ReturnType<typeof material>[] = [];
  let fresh = async () => material();
  const keys = createRoutineKeys({
    pure: async () => pureCircuits,
    now: () => clock,
    monotonic: () => clock,
    unlock: async () => material(),
  });
  await keys.unlock(account, 10, 'passport.example', 'https://passport.example', true);
  keys.verifyOwner(account);
  const reviews = createRoutineReviews({
    keys,
    pure: async () => pureCircuits,
    async unlock(target, rpId) {
      assert.equal(target, account);
      requests.push(rpId);
      const value = await fresh();
      outputs.push(value);
      return value;
    },
  });
  return {
    account,
    keys,
    reviews,
    requests,
    outputs,
    fresh(load: typeof fresh) {
      fresh = load;
    },
    expire() {
      clock += 600_000;
    },
  };
}

test('critical review passes the lease RP ID to the real PRF verifier and reuses approval only within that action', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(f.keys.credentialScope(f.account), {
      rpId: 'passport.example',
      origin: 'https://passport.example',
    });
    assert.ok(Object.isFrozen(f.keys.credentialScope(f.account)));
    assert.equal(f.reviews.beginRoutineReview(f.account, 'rotate'), true);
    await f.reviews.beforeAuthenticatedOperation('rotateViewingKey');
    await f.reviews.beforeAuthenticatedOperation('rotateEncryptionKey');
    assert.deepEqual(f.requests, ['passport.example']);
    f.reviews.finishRoutineReview();
    await assert.rejects(
      f.reviews.beforeAuthenticatedOperation('rotateViewingKey'),
      /Start a reviewed/,
    );
    assert.equal(f.reviews.beginRoutineReview(f.account, 'rotate'), true);
    await f.reviews.beforeAuthenticatedOperation('rotateViewingKey');
    assert.deepEqual(f.requests, ['passport.example', 'passport.example']);
    assert.ok(
      f.outputs.every((o) => o.root.every((b) => b === 0) && o.authoriser.every((b) => b === 0)),
    );
  } finally {
    f.keys.lock();
  }
});

test('mismatched method and routine reads cannot borrow an owner review or request fresh credentials', async () => {
  const f = await fixture();
  try {
    f.reviews.beginRoutineReview(f.account, 'rotate');
    await assert.rejects(
      f.reviews.beforeAuthenticatedOperation('withdrawUnshielded'),
      /Start a reviewed/,
    );
    f.reviews.beginRoutineReview(f.account, 'holdings');
    await assert.rejects(f.reviews.approveCriticalOwner(), /Start a reviewed/);
    await f.reviews.beforeAuthenticatedOperation('state');
    assert.equal(f.requests.length, 0);
  } finally {
    f.keys.lock();
  }
});

for (const invalid of ['expiry', 'lock', 'credential', 'account'] as const) {
  test(`critical review refuses ${invalid} before fresh credential access and has no fallback`, async () => {
    const f = await fixture();
    try {
      f.reviews.beginRoutineReview(f.account, 'rotate');
      if (invalid === 'expiry') f.expire();
      if (invalid === 'lock') f.keys.lock();
      if (invalid === 'credential') f.account.credentialId?.fill(8);
      if (invalid === 'account') Object.assign(f.account, { address: 'cd'.repeat(32) });
      await assert.rejects(f.reviews.beforeAuthenticatedOperation('rotateViewingKey'));
      assert.equal(f.requests.length, 0);
    } finally {
      f.keys.lock();
    }
  });
}

for (const during of ['review', 'renewal', 'lock'] as const) {
  test(`changing ${during} during fresh approval refuses late output and clears its owned bytes`, async () => {
    const f = await fixture();
    const pending = gate(),
      entered = gate();
    f.fresh(async () => {
      entered.release();
      await pending.wait;
      return material();
    });
    try {
      f.reviews.beginRoutineReview(f.account, 'rotate');
      const result = f.reviews.beforeAuthenticatedOperation('rotateViewingKey');
      await entered.wait;
      if (during === 'review') f.reviews.finishRoutineReview();
      if (during === 'lock') f.keys.lock();
      if (during === 'renewal')
        await f.keys.unlock(f.account, 10, 'other.example', 'https://other.example', true);
      pending.release();
      await assert.rejects(result, /ended|changed|locked|expired/);
      assert.equal(f.requests.length, 1);
      assert.equal(f.outputs.length, 1);
      assert.ok(
        f.outputs.every((o) => o.root.every((b) => b === 0) && o.authoriser.every((b) => b === 0)),
      );
    } finally {
      pending.release();
      f.keys.lock();
    }
  });
}

test('declined approval stays refused in the same review; a new explicit action can retry', async () => {
  const f = await fixture();
  try {
    f.reviews.beginRoutineReview(f.account, 'rotate');
    f.fresh(async () => {
      throw new DOMException('Declined', 'NotAllowedError');
    });
    await assert.rejects(f.reviews.beforeAuthenticatedOperation('rotateViewingKey'), /Declined/);
    await assert.rejects(f.reviews.beforeAuthenticatedOperation('rotateViewingKey'), /Declined/);
    assert.equal(f.requests.length, 1);
    f.fresh(async () => material());
    f.reviews.beginRoutineReview(f.account, 'rotate');
    await f.reviews.beforeAuthenticatedOperation('rotateViewingKey');
    assert.equal(f.requests.length, 2);
  } finally {
    f.keys.lock();
  }
});

test('fresh approval rejects a different derived owner without replacing the captured lease', async () => {
  const f = await fixture();
  const owner = f.keys.ownerSession(f.account);
  try {
    f.reviews.beginRoutineReview(f.account, 'rotate');
    f.fresh(async () => ({ ...material(), authoriser: new Uint8Array(32).fill(8) }));
    await assert.rejects(
      f.reviews.beforeAuthenticatedOperation('rotateViewingKey'),
      /does not match/,
    );
    assert.equal(f.keys.ownerSession(f.account), owner);
    assert.equal(f.requests.length, 1);
  } finally {
    f.keys.lock();
  }
});
