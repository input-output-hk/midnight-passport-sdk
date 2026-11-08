import assert from 'node:assert/strict';
import { test } from 'node:test';
import { routeAuthenticatedAccount } from '../packages/account/dist/authorization.js';

/** @typedef {import('../packages/protocol/dist/index.js').PassportAccount} Account */

function gate() {
  /** @type {() => void} */
  let release = () => {};
  const promise = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  return { promise, release };
}

function fixture() {
  /** @type {string[]} */
  const calls = [];
  /** @param {'p256-webauthn' | 'jubjub-schnorr'} scheme @returns {Account} */
  const account = (scheme) => ({
    address: 'ab'.repeat(32),
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    scheme,
    state: async () => {
      calls.push(`${scheme}:state`);
      return { booted: true, authNonce: 0n, deviceEpoch: 0n, entryCount: 1, specVersion: 3 };
    },
    deviceRoster: async () => {
      calls.push(`${scheme}:deviceRoster`);
      return { authNonce: 0n, deviceEpoch: 0n, commitments: [] };
    },
    grantRoster: async () => {
      calls.push(`${scheme}:grantRoster`);
      return { authNonce: 0n, generation: 0n, entries: [] };
    },
    rotateEncryptionKey: async () => {
      calls.push(`${scheme}:rotate`);
      return { txHash: 'cd'.repeat(32) };
    },
  });
  const primary = account('p256-webauthn');
  const owner = account('jubjub-schnorr');
  /** @type {Account | undefined} */
  let selected = owner;
  let valid = true;
  const check = () => {
    if (!valid) throw new Error('Lease expired');
  };
  return {
    calls,
    primary,
    owner,
    check,
    account,
    selected: () => selected,
    select: (/** @type {Account | undefined} */ next) => {
      selected = next;
    },
    expire: () => {
      valid = false;
    },
  };
}

test('an authenticated method waits for its host hook and preserves method arguments and receiver', async () => {
  const f = fixture();
  const approval = gate();
  const key = new Uint8Array(32).fill(7);
  const signal = new AbortController().signal;
  const onEvent = () => {};
  const options = { signal, onEvent };
  f.owner.rotateEncryptionKey = async function (actualKey, actualOptions) {
    assert.equal(this, f.owner);
    assert.notEqual(actualKey, key);
    assert.deepEqual(actualKey, new Uint8Array(32).fill(7));
    assert.notEqual(actualOptions, options);
    assert.equal(actualOptions?.signal, signal);
    assert.equal(actualOptions?.onEvent, onEvent);
    f.calls.push('owner-dispatched');
    return { txHash: 'cd'.repeat(32) };
  };
  const routed = routeAuthenticatedAccount(f.primary, f.selected, f.check, async (method, args) => {
    assert.equal(method, 'rotateEncryptionKey');
    assert.deepEqual(args, [key, options]);
    f.calls.push('fresh-approval');
    await approval.promise;
  });
  const result = routed.rotateEncryptionKey(key, options);
  assert.deepEqual(f.calls, ['fresh-approval']);
  key.fill(99);
  options.onEvent = () => {
    throw new Error('Caller replaced event callback');
  };
  approval.release();
  assert.equal((await result).txHash, 'cd'.repeat(32));
  assert.deepEqual(f.calls, ['fresh-approval', 'owner-dispatched']);
});

test('hook mutation cannot rewrite admitted Buffer bytes, nested scope data or joining-device policy', async () => {
  const f = fixture();
  const approval = gate();
  const key = Buffer.alloc(32, 7);
  f.owner.rotateEncryptionKey = async (actual) => {
    assert.deepEqual(actual, new Uint8Array(32).fill(7));
    return { txHash: 'cd'.repeat(32) };
  };
  const routed = routeAuthenticatedAccount(
    f.primary,
    f.selected,
    f.check,
    async (_method, args) => {
      assert.ok(args[0] instanceof Uint8Array);
      args[0].fill(42);
      await approval.promise;
    },
  );
  const result = routed.rotateEncryptionKey(key);
  key.fill(99);
  approval.release();
  await result;
});

test('nested grant scope is captured before fresh approval while trusted flow capabilities retain identity', async () => {
  const f = fixture();
  const approval = gate();
  const operations = /** @type {'withdraw-unshielded'[]} */ (['withdraw-unshielded']);
  const scope = {
    grantee: { scheme: /** @type {const} */ ('jubjub-schnorr'), publicKey: 'ab'.repeat(32) },
    operations,
    color: '00'.repeat(32),
    recipient: { kind: /** @type {const} */ ('user-address'), value: 'cd'.repeat(32) },
    maxCoinValue: '5',
    perCallCap: '1',
    cap: '5',
    expiresAt: null,
    window: { lengthSeconds: 60, cap: '2' },
  };
  const expected = structuredClone(scope);
  f.owner.issueGrant = async (actual) => {
    assert.deepEqual(actual, expected);
    assert.ok(Object.isFrozen(actual));
    assert.ok(Object.isFrozen(actual.grantee));
    return {
      txHash: 'cd'.repeat(32),
      grantId: 'ab'.repeat(32),
      slot: 0,
      scopeDigest: 'ef'.repeat(32),
      status: 'active',
      nextUseCounter: 1n,
      appendTxHashes: [],
    };
  };
  const routed = routeAuthenticatedAccount(
    f.primary,
    f.selected,
    f.check,
    async () => approval.promise,
  );
  assert.ok(routed.issueGrant);
  const result = routed.issueGrant(scope);
  scope.grantee.publicKey = 'ef'.repeat(32);
  scope.recipient.value = 'ff'.repeat(32);
  scope.window.cap = '999';
  operations.splice(0);
  approval.release();
  await result;
});

test('joining-device policy bytes are admitted before the fresh approval await', async () => {
  const f = fixture();
  const approval = gate();
  const reader = {
    scheme: /** @type {const} */ ('p256-webauthn'),
    readerPublicKey: 'ab'.repeat(32),
    devicePublicKey: '02' + 'cd'.repeat(32),
    policy: { rp_id_hash: Buffer.alloc(32, 7), origin: new Uint8Array(21).fill(9) },
  };
  f.owner.addDevice = async (actual) => {
    assert.equal(actual.readerPublicKey, 'ab'.repeat(32));
    assert.equal(actual.devicePublicKey, '02' + 'cd'.repeat(32));
    assert.ok('scheme' in actual);
    assert.deepEqual(actual.policy.rp_id_hash, new Uint8Array(32).fill(7));
    assert.deepEqual(actual.policy.origin, new Uint8Array(21).fill(9));
    return { txHash: 'cd'.repeat(32), commitmentHex: 'ab'.repeat(32), nextUseCounter: 1n };
  };
  const routed = routeAuthenticatedAccount(
    f.primary,
    f.selected,
    f.check,
    async () => approval.promise,
  );
  assert.ok(routed.addDevice);
  const result = routed.addDevice(reader);
  reader.readerPublicKey = 'ff'.repeat(32);
  reader.policy.rp_id_hash.fill(0);
  reader.policy.origin.fill(0);
  approval.release();
  await result;
});

for (const input of [
  new Date(),
  new Map(),
  {
    get surprise() {
      throw new Error('Getter ran');
    },
  },
]) {
  test(`unsupported mutable input ${input.constructor.name} refuses before fresh authentication`, () => {
    const f = fixture();
    let prompts = 0;
    const routed = routeAuthenticatedAccount(f.primary, f.selected, f.check, async () => {
      prompts++;
    });
    assert.throws(() => Reflect.apply(routed.rotateEncryptionKey, routed, [input]), {
      code: 'InvalidContext',
    });
    assert.equal(prompts, 0);
    assert.deepEqual(f.calls, []);
  });
}

test('declining fresh authenticated approval dispatches neither owner nor primary operation', async () => {
  const f = fixture();
  const routed = routeAuthenticatedAccount(f.primary, f.selected, f.check, async () => {
    throw new Error('Fresh approval declined');
  });
  await assert.rejects(routed.rotateEncryptionKey(new Uint8Array(32)), /Fresh approval declined/);
  assert.deepEqual(f.calls, []);
});

for (const change of ['expiry', 'lock', 'replacement', 'context', 'primary-context']) {
  test(`authenticated route ${change} during fresh approval refuses without fallback`, async () => {
    const f = fixture();
    const approval = gate();
    const routed = routeAuthenticatedAccount(
      f.primary,
      f.selected,
      f.check,
      async () => approval.promise,
    );
    const result = routed.rotateEncryptionKey(new Uint8Array(32));
    if (change === 'expiry') f.expire();
    else if (change === 'lock') f.select(undefined);
    else if (change === 'replacement') f.select(f.account('jubjub-schnorr'));
    else
      Object.defineProperty(change === 'context' ? f.owner : f.primary, 'networkId', {
        value: 'changed',
      });
    const refusal = assert.rejects(
      result,
      change === 'expiry'
        ? /Lease expired/
        : {
            code: change.includes('context') ? 'InvalidContext' : 'Unavailable',
          },
    );
    approval.release();
    await refusal;
    assert.deepEqual(f.calls, []);
  });
}

test('primary operations bypass the authenticated hook', async () => {
  const f = fixture();
  f.select(undefined);
  let prompts = 0;
  const routed = routeAuthenticatedAccount(f.primary, f.selected, f.check, async () => {
    prompts++;
  });
  await routed.rotateEncryptionKey(new Uint8Array(32));
  assert.equal(prompts, 0);
  assert.deepEqual(f.calls, ['p256-webauthn:rotate']);
});

test('public state and rosters use the primary account without fresh authentication or an active lease', async () => {
  const f = fixture();
  f.expire();
  let prompts = 0;
  const routed = routeAuthenticatedAccount(f.primary, f.selected, f.check, async () => {
    prompts++;
  });
  await routed.state();
  assert.ok(routed.deviceRoster);
  await routed.deviceRoster();
  assert.ok(routed.grantRoster);
  await routed.grantRoster();
  assert.equal(prompts, 0);
  assert.deepEqual(f.calls, [
    'p256-webauthn:state',
    'p256-webauthn:deviceRoster',
    'p256-webauthn:grantRoster',
  ]);
});

test('a stale captured route refuses before invoking fresh authentication', () => {
  const f = fixture();
  let prompts = 0;
  const routed = routeAuthenticatedAccount(f.primary, f.selected, f.check, async () => {
    prompts++;
  });
  const captured = routed.rotateEncryptionKey;
  f.select(undefined);
  assert.throws(() => captured(new Uint8Array(32)), { code: 'Unavailable' });
  assert.equal(prompts, 0);
  assert.deepEqual(f.calls, []);
});

test('a dispatched mutation receipt survives expiry and route replacement after approval', async () => {
  const f = fixture();
  const receipt = gate();
  f.owner.rotateEncryptionKey = async () => {
    f.calls.push('owner-dispatched');
    await receipt.promise;
    return { txHash: 'cd'.repeat(32) };
  };
  let prompts = 0;
  const routed = routeAuthenticatedAccount(f.primary, f.selected, f.check, async () => {
    prompts++;
  });
  const result = routed.rotateEncryptionKey(new Uint8Array(32));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.calls, ['owner-dispatched']);
  f.expire();
  f.select(undefined);
  receipt.release();
  assert.equal((await result).txHash, 'cd'.repeat(32));
  assert.equal(prompts, 1);
});
