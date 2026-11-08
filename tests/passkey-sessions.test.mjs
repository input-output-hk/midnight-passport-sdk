// Private lifetime contract: owned PRF buffers, no browser or credential fixture.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPasskeySessions } from '../packages/adapter-webauthn/dist/sessions.js';

/** @typedef {import('../packages/adapter-webauthn/dist/prf.js').PasskeyPrfOutputs} Outputs */

/** @template T */
function deferred() {
  /** @type {(value: T) => void} */
  let resolve = () => {};
  /** @type {(reason?: unknown) => void} */
  let reject = () => {};
  const promise = new Promise((/** @type {(value: T) => void} */ yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

/** @returns {Outputs} */
const fresh = () => ({ authoriser: new Uint8Array(32).fill(7), root: new Uint8Array(32).fill(11) });
/** @param {Outputs} value */
function assertZero(value) {
  assert.ok(
    value.authoriser.every((byte) => byte === 0),
    'owner PRF output is zero',
  );
  assert.ok(
    value.root.every((byte) => byte === 0),
    'reader-root PRF output is zero',
  );
}
const unexpectedLoad = async () => {
  throw new Error('Unexpected PRF ceremony');
};

for (const failure of [false, true]) {
  test(`login ${failure ? 'failure' : 'success'} zeros its actual owned buffers`, async () => {
    const held = fresh();
    const sessions = createPasskeySessions(unexpectedLoad);
    const work = sessions.withLoginSession(async () => {
      assert.equal(sessions.active(), true);
      await sessions.identify(async () => ({ identity: 'picked', outputs: held }));
      for (let check = 0; check < 2; check++) {
        await sessions.prf.withSession(async () => {
          const secret = await sessions.prf.deviceSecret();
          assert.deepEqual(secret, new Uint8Array(32).fill(7));
          secret.fill(0);
          assert.ok(
            held.authoriser.some((byte) => byte !== 0),
            'nested exit keeps login-owned keys',
          );
        });
      }
      if (failure) throw new Error('Account check failed');
      return 'opened';
    });
    if (failure) await assert.rejects(work, /Account check failed/);
    else assert.equal(await work, 'opened');
    assert.equal(sessions.active(), false);
    assertZero(held);
    await assert.rejects(sessions.prf.deviceSecret(), /Unexpected PRF ceremony/);
  });
}

test('a late abandoned identification is refused and zeroed without disturbing a newer login', async () => {
  const sessions = createPasskeySessions(unexpectedLoad);
  const late = fresh();
  const current = fresh();
  const gate = /** @type {ReturnType<typeof deferred<{ identity: string; outputs: Outputs }>>} */ (
    deferred()
  );
  /** @type {Promise<string>} */
  let abandoned = Promise.resolve('not started');
  await sessions.withLoginSession(async () => {
    abandoned = sessions.identify(() => gate.promise);
    void abandoned.catch(() => undefined);
  });
  await sessions.withLoginSession(async () => {
    await sessions.identify(async () => ({ identity: 'new', outputs: current }));
    gate.resolve({ identity: 'old', outputs: late });
    await assert.rejects(abandoned, { code: 'NotAuthorised' });
    assertZero(late);
    const secret = await sessions.prf.deviceSecret();
    assert.deepEqual(secret, new Uint8Array(32).fill(7));
    secret.fill(0);
    assert.ok(current.root.some((byte) => byte !== 0));
  });
  assertZero(current);
});

test('ending login zeros keys immediately even when an abandoned nested child remains pending', async () => {
  const sessions = createPasskeySessions(unexpectedLoad);
  const held = fresh();
  const gate = /** @type {ReturnType<typeof deferred<void>>} */ (deferred());
  /** @type {Promise<void>} */
  let child = Promise.resolve();
  try {
    await sessions.withLoginSession(async () => {
      await sessions.identify(async () => ({ identity: 'picked', outputs: held }));
      child = sessions.prf.withSession(async () => {
        await gate.promise;
      });
    });
    assertZero(held);
    assert.equal(sessions.active(), false);
    await assert.rejects(
      sessions.withLoginSession(async () => undefined),
      { code: 'NotAuthorised' },
    );
  } finally {
    gate.resolve(undefined);
    await child;
  }
  assert.equal(await sessions.withLoginSession(async () => 'new scope'), 'new scope');
});

test('identification requires a fresh scope and cannot retry after failed selection', async () => {
  let gets = 0;
  let loads = 0;
  const sessions = createPasskeySessions(async () => {
    loads++;
    return fresh();
  });
  const select = async () => {
    gets++;
    return { identity: 'picked', outputs: fresh() };
  };
  await assert.rejects(sessions.identify(select), { code: 'NotAuthorised' });
  assert.equal(gets, 0);
  await sessions.withLoginSession(async () => {
    await assert.rejects(sessions.prf.deviceSecret(), { code: 'NotAuthorised' });
    await assert.rejects(
      sessions.identify(async () => {
        gets++;
        throw new Error('Cancelled');
      }),
      /Cancelled/,
    );
    await assert.rejects(sessions.identify(select), { code: 'NotAuthorised' });
    await assert.rejects(sessions.prf.deviceSecret(), { code: 'NotAuthorised' });
  });
  assert.equal(gets, 1);
  assert.equal(loads, 0, 'failed selection never falls back to a new ceremony');
});

test('ordinary overlapping PRF users share a single load and release only after the last child', async () => {
  const held = fresh();
  const loadGate = /** @type {ReturnType<typeof deferred<Outputs>>} */ (deferred());
  const childGate = /** @type {ReturnType<typeof deferred<void>>} */ (deferred());
  let loads = 0;
  const sessions = createPasskeySessions(() => {
    loads++;
    return loadGate.promise;
  });
  const first = sessions.prf.withSession(() => sessions.prf.deviceSecret());
  const second = sessions.prf.withSession(async () => {
    await childGate.promise;
    return sessions.prf.deviceSecret();
  });
  assert.equal(loads, 1);
  loadGate.resolve(held);
  const one = await first;
  try {
    assert.deepEqual(one, new Uint8Array(32).fill(7));
    assert.ok(held.authoriser.some((byte) => byte !== 0));
    await assert.rejects(
      sessions.withLoginSession(async () => undefined),
      { code: 'NotAuthorised' },
    );
  } finally {
    childGate.resolve(undefined);
    one.fill(0);
  }
  const two = await second;
  assert.deepEqual(two, new Uint8Array(32).fill(7));
  two.fill(0);
  assertZero(held);
  assert.equal(loads, 1);
});

test('a shared failed ordinary PRF load is released and the next session can recover', async () => {
  const loadGate = /** @type {ReturnType<typeof deferred<Outputs>>} */ (deferred());
  const held = fresh();
  let loads = 0;
  const sessions = createPasskeySessions(async () => {
    loads++;
    return loads === 1 ? loadGate.promise : held;
  });
  const first = sessions.prf.withSession(async () => 'unreachable');
  const second = sessions.prf.withSession(async () => 'unreachable');
  const refusals = [assert.rejects(first, /No PRF/), assert.rejects(second, /No PRF/)];
  loadGate.reject(new Error('No PRF'));
  await Promise.all(refusals);
  assert.equal(loads, 1);
  const recovered = await sessions.prf.deviceSecret();
  assert.deepEqual(recovered, new Uint8Array(32).fill(7));
  recovered.fill(0);
  assertZero(held);
  assert.equal(loads, 2);
});
