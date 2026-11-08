// Internal lifetime tests. No provider, native proof or actual credential operation.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPasskeySessions } from '../packages/adapter-webauthn/dist/sessions.js';

const fresh = () => ({ authoriser: new Uint8Array(32).fill(7), root: new Uint8Array(32).fill(11) });
/** @typedef {import('../packages/adapter-webauthn/dist/prf.js').PasskeyPrfOutputs} Outputs */
/** @template [T=void] */
const deferred = () => {
  /** @type {(value: T) => void} */
  let resolve = () => {};
  /** @type {(reason?: unknown) => void} */
  let reject = () => {};
  const promise = new Promise((/** @type {(value: T) => void} */ yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
/** @param {Outputs} held */
const zero = (held) => {
  assert.ok(held.authoriser.every((value) => value === 0));
  assert.ok(held.root.every((value) => value === 0));
};

test('ownership-only work does not load, and still blocks overlapping login', async () => {
  let loads = 0;
  const sessions = createPasskeySessions(async () => {
    loads++;
    return fresh();
  });
  await sessions.withScope(async () => {
    assert.equal(sessions.busy(), true);
    await assert.rejects(
      sessions.withLoginSession(async () => {}),
      { code: 'NotAuthorised' },
    );
  });
  assert.equal(loads, 0);
  assert.equal(sessions.busy(), false);
});

test('lazy outer and overlapping eager children share one load until the last owner exits', async () => {
  const held = fresh();
  let loads = 0;
  const sessions = createPasskeySessions(async () => {
    loads++;
    return held;
  });
  const outerGate = deferred();
  const loaded = deferred();
  const outer = sessions.withScope(async () => {
    const one = await sessions.prf.deviceSecret();
    const two = await sessions.prf.deriveSecret({ domain: 'ownership-test', context: 'test' });
    one.fill(0);
    two.fill(0);
    loaded.resolve();
    await outerGate.promise;
  });
  await loaded.promise;
  const copy = await sessions.prf.deviceSecret();
  assert.equal(loads, 1);
  assert.deepEqual(copy, new Uint8Array(32).fill(7));
  assert.ok(held.root.some((value) => value !== 0));
  outerGate.resolve();
  await outer;
  zero(held);
  assert.deepEqual(copy, new Uint8Array(32).fill(7), 'caller owns its independent copy');
  copy.fill(0);
  assert.equal(sessions.busy(), false);
});

for (const sync of [false, true]) {
  test(`a ${sync ? 'synchronous' : 'asynchronous'} failed load stays refused until its lazy scope ends`, async () => {
    let loads = 0;
    const held = fresh();
    const sessions = createPasskeySessions(() => {
      loads++;
      if (loads === 1) {
        if (sync) throw new Error('No PRF');
        return Promise.reject(new Error('No PRF'));
      }
      return Promise.resolve(held);
    });
    await sessions.withScope(async () => {
      await assert.rejects(sessions.prf.deviceSecret(), /No PRF/);
      await assert.rejects(sessions.prf.deviceSecret(), /No PRF/);
      await assert.rejects(
        sessions.withScope(async () => assert.fail()),
        /No PRF/,
      );
      assert.equal(loads, 1, 'caught error cannot silently request another ceremony');
    });
    const recovered = await sessions.prf.deviceSecret();
    recovered.fill(0);
    zero(held);
    assert.equal(loads, 2);
    assert.equal(sessions.busy(), false);
  });
}

test('shared deferred failure rejects every waiter once and releases all users', async () => {
  const gate = /** @type {ReturnType<typeof deferred<Outputs>>} */ (deferred());
  let loads = 0;
  const sessions = createPasskeySessions(() => {
    loads++;
    return gate.promise;
  });
  const first = sessions.prf.withSession(async () => assert.fail());
  const second = sessions.prf.withSession(async () => assert.fail());
  const refusals = [assert.rejects(first, /No PRF/), assert.rejects(second, /No PRF/)];
  assert.equal(loads, 1);
  gate.reject(new Error('No PRF'));
  await Promise.all(refusals);
  assert.equal(sessions.busy(), false);
});

test('a pending unawaited child owns its load until completion and then clears it', async () => {
  const gate = /** @type {ReturnType<typeof deferred<Outputs>>} */ (deferred());
  const held = fresh();
  const sessions = createPasskeySessions(() => gate.promise);
  /** @type {Promise<Uint8Array>} */
  let child = Promise.resolve(new Uint8Array());
  await sessions.withScope(async () => {
    child = sessions.prf.deviceSecret();
  });
  assert.equal(sessions.busy(), true);
  await assert.rejects(
    sessions.withLoginSession(async () => {}),
    { code: 'NotAuthorised' },
  );
  gate.resolve(held);
  const copy = await child;
  zero(held);
  copy.fill(0);
  assert.equal(sessions.busy(), false);
});

test('ready/failed login never admits lazy work against a previously selected credential', async () => {
  const sessions = createPasskeySessions(async () => assert.fail('No fallback load'));
  await sessions.withLoginSession(async () => {
    await assert.rejects(
      sessions.withScope(async () => assert.fail()),
      { code: 'NotAuthorised' },
    );
    await assert.rejects(
      sessions.identify(async () => {
        throw new Error('Cancelled');
      }),
      /Cancelled/,
    );
    await assert.rejects(
      sessions.withScope(async () => assert.fail()),
      { code: 'NotAuthorised' },
    );
  });
  assert.equal(sessions.busy(), false);
});

test('login ending clears keys immediately and abandoned lazy work cannot reacquire them', async () => {
  const held = fresh();
  const gate = deferred();
  const sessions = createPasskeySessions(async () => assert.fail('No reload'));
  let child = Promise.resolve();
  await sessions.withLoginSession(async () => {
    await sessions.identify(async () => ({ identity: 'known', outputs: held }));
    child = sessions.withScope(async () => {
      await gate.promise;
      await assert.rejects(sessions.prf.deviceSecret(), { code: 'NotAuthorised' });
    });
  });
  zero(held);
  await assert.rejects(
    sessions.withLoginSession(async () => {}),
    { code: 'NotAuthorised' },
  );
  gate.resolve();
  await child;
  await sessions.withLoginSession(async () => {});
});
