import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createAccountAuthorisation,
  routeAuthenticatedAccount,
} from '../packages/account/dist/authorization.js';

/** @param {'p256-webauthn'|'jubjub-schnorr'} [scheme] */
const account = (scheme = 'p256-webauthn') =>
  /** @type {import('../packages/protocol/dist/index.js').PassportAccount} */ (
    /** @type {unknown} */ ({
      address: 'ab'.repeat(32),
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      scheme,
    })
  );
const flow = /** @type {const} */ ({
  kind: 'withdraw-unshielded',
  color: '00'.repeat(32),
  amount: '1',
  recipient: 'cd'.repeat(32),
});
const invalid = (/** @type {unknown} */ error) => {
  assert.ok(error instanceof Error && 'code' in error);
  assert.equal(error.code, 'InvalidContext');
  assert.equal(error.cause, undefined);
  assert.doesNotMatch(String(error), /private/);
  return true;
};
function fixture() {
  const primary = account(),
    owner = account('jubjub-schnorr');
  let checks = 0,
    valid = true,
    context = true;
  const lease = {
    account: owner,
    check() {
      assert.equal(this, lease);
      checks++;
      if (!valid) throw Error('expired');
    },
  };
  let selected = lease;
  /** @type {import('../packages/account/dist/authorization.js').AccountConsent[]} */
  const reviews = [];
  const options = {
    primary,
    isContextCurrent: () => context,
    authenticated: () => selected,
    consent: {
      async review(
        /** @type {import('../packages/account/dist/authorization.js').AccountConsent} */ request,
      ) {
        reviews.push(request);
        return true;
      },
    },
  };
  return {
    primary,
    owner,
    lease,
    options,
    reviews,
    checks: () => checks,
    expire() {
      valid = false;
    },
    switchContext() {
      context = false;
    },
    replace() {
      selected = { account: owner, check() {} };
    },
  };
}

test('captured owner checker keeps its receiver and identity throughout review and private read', async () => {
  const f = fixture();
  const result = await createAccountAuthorisation(f.options).run(
    { route: 'authenticated-owner', flow: { kind: 'read-holdings' } },
    async (_account, approved) => approved.scheme,
  );
  assert.equal(result, 'jubjub-schnorr');
  assert.equal(f.checks(), 3);
});

for (const route of /** @type {const} */ (['primary', 'authenticated-owner'])) {
  test(`${route}: in-place scheme replacement during review refuses before dispatch`, async () => {
    const f = fixture();
    let dispatched = 0;
    f.options.consent.review = async () => {
      Object.assign(route === 'primary' ? f.primary : f.owner, {
        scheme: route === 'primary' ? 'jubjub-schnorr' : 'p256-webauthn',
      });
      return true;
    };
    await assert.rejects(
      createAccountAuthorisation(f.options).run({ route, flow }, async () => {
        dispatched++;
      }),
      invalid,
    );
    assert.equal(dispatched, 0);
  });
  test(`${route}: private results recheck scheme, but dispatched mutation receipts survive later replacement`, async () => {
    let f = fixture();
    await assert.rejects(
      createAccountAuthorisation(f.options).run(
        { route, flow: { kind: 'read-holdings' } },
        async (a) => {
          Object.assign(a, { scheme: 'k256-ecdsa' });
          return 'private';
        },
      ),
      invalid,
    );
    f = fixture();
    const receipt = await createAccountAuthorisation(f.options).run(
      { route, flow },
      async (a, approved) => {
        const reviewed = approved.scheme;
        Object.assign(a, { scheme: 'k256-ecdsa' });
        f.switchContext();
        return { txHash: 'original', reviewed };
      },
    );
    assert.equal(receipt.txHash, 'original');
    assert.equal(receipt.reviewed, route === 'primary' ? 'p256-webauthn' : 'jubjub-schnorr');
  });
}

test('in-place checker replacement cannot replace an expired approval and never falls back', async () => {
  for (const change of ['method', 'lease', 'context']) {
    const f = fixture();
    let dispatched = 0;
    f.options.consent.review = async () => {
      if (change === 'method') {
        f.expire();
        f.lease.check = () => {};
      } else if (change === 'lease') f.replace();
      else f.switchContext();
      return true;
    };
    await assert.rejects(
      createAccountAuthorisation(f.options).run(
        { route: 'authenticated-owner', flow },
        async () => {
          dispatched++;
        },
      ),
      { code: 'Unavailable' },
    );
    assert.equal(dispatched, 0);
    assert.equal(f.checks(), 1);
  }
});

test('private reads reject checker replacement after work; mutation acknowledgement is preserved', async () => {
  let f = fixture();
  await assert.rejects(
    createAccountAuthorisation(f.options).run(
      { route: 'authenticated-owner', flow: { kind: 'read-holdings' } },
      async () => {
        f.lease.check = () => {};
        return 'private';
      },
    ),
    { code: 'Unavailable' },
  );
  f = fixture();
  const result = await createAccountAuthorisation(f.options).run(
    { route: 'authenticated-owner', flow },
    async () => {
      f.lease.check = () => {};
      f.expire();
      return { txHash: 'submitted' };
    },
  );
  assert.equal(result.txHash, 'submitted');
});

test('compatibility route refuses a scheme change while its fresh approval hook is pending', async () => {
  const f = fixture();
  let dispatched = 0;
  f.owner.rotateViewingKey = async () => {
    dispatched++;
    throw Error('must not dispatch');
  };
  const routed = routeAuthenticatedAccount(
    f.primary,
    () => f.owner,
    () => {},
    async () => {
      Object.assign(f.owner, { scheme: 'p256-webauthn' });
    },
  );
  assert.ok(routed.rotateViewingKey);
  await assert.rejects(routed.rotateViewingKey(), invalid);
  assert.equal(dispatched, 0);
});

/** @param {Uint8Array} bytes @param {number} length */
const shadow = (bytes, length) => {
  Object.defineProperties(bytes, { length: { value: length }, byteLength: { value: length } });
  return bytes;
};

test('public argument snapshots ignore shadowed lengths/iterators, isolate Buffer slices and allow empty bytes', async () => {
  const f = fixture();
  let iteratorCalls = 0;
  let hookCalls = 0;
  const backing = Buffer.from([9, 1, 2, 9]);
  const bytes = backing.subarray(1, 3);
  Object.defineProperties(bytes, {
    length: {
      get() {
        throw Error('private length');
      },
    },
    byteLength: {
      get() {
        throw Error('private byteLength');
      },
    },
    [Symbol.iterator]: {
      get() {
        iteratorCalls++;
        throw Error('private iterator');
      },
    },
  });
  /** @type {unknown} */ let observed;
  f.owner.addDevice = async (input) => {
    observed = input;
    return { txHash: 'synthetic', commitmentHex: '00'.repeat(32), nextUseCounter: 0n };
  };
  const routed = routeAuthenticatedAccount(
    f.primary,
    () => f.owner,
    () => {},
    async (_method, args) => {
      hookCalls++;
      const input = /** @type {{policy:{rp_id_hash:Uint8Array},empty:Uint8Array}} */ (args[0]);
      assert.deepEqual(input.policy.rp_id_hash, Uint8Array.of(1, 2));
      input.policy.rp_id_hash.fill(8);
      backing.fill(7);
    },
  );
  assert.ok(routed.addDevice);
  await routed.addDevice(
    /** @type {import('../packages/protocol/dist/index.js').PassportDeviceReader} */ (
      /** @type {unknown} */ ({ policy: { rp_id_hash: bytes }, empty: new Uint8Array() })
    ),
  );
  const admitted = /** @type {{policy:{rp_id_hash:Uint8Array},empty:Uint8Array}} */ (observed);
  assert.deepEqual(admitted.policy.rp_id_hash, Uint8Array.of(1, 2));
  assert.equal(admitted.empty.byteLength, 0);
  assert.equal(iteratorCalls, 0);
  assert.equal(hookCalls, 1);
  assert.deepEqual([...backing], [7, 7, 7, 7]);
});

test('oversized, proxy, malformed and detached public bytes refuse before review or dispatch', async () => {
  const f = fixture();
  let hookCalls = 0,
    dispatched = 0,
    iteratorCalls = 0;
  f.owner.addDevice = async () => {
    dispatched++;
    throw Error('must not dispatch');
  };
  const routed = routeAuthenticatedAccount(
    f.primary,
    () => f.owner,
    () => {},
    async () => {
      hookCalls++;
    },
  );
  const oversized = shadow(new Uint8Array(65537), 1);
  Object.defineProperty(oversized, Symbol.iterator, {
    get() {
      iteratorCalls++;
      throw Error('private iterator');
    },
  });
  const detached = Uint8Array.of(1);
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  assert.ok(routed.addDevice);
  const add = routed.addDevice;
  for (const bytes of [
    oversized,
    detached,
    new Proxy(Uint8Array.of(1), {}),
    new Proxy(Uint8Array.of(1), {
      getPrototypeOf() {
        throw Error('private proxy');
      },
    }),
    Object.create(Uint8Array.prototype),
  ])
    assert.throws(
      () =>
        add(
          /** @type {import('../packages/protocol/dist/index.js').PassportDeviceReader} */ (
            /** @type {unknown} */ ({ policy: { rp_id_hash: bytes } })
          ),
        ),
      invalid,
    );
  assert.equal(iteratorCalls, 0);
  assert.equal(hookCalls, 0);
  assert.equal(dispatched, 0);
});

test('reader policy validation and consent copies use intrinsic lengths and actual bytes', async () => {
  const f = fixture();
  let iterated = 0;
  const bytes = shadow(new Uint8Array(32).fill(4), 1);
  bytes[Symbol.iterator] = function* () {
    iterated++;
    throw Error('private iterator');
  };
  const reader = {
    scheme: /** @type {const} */ ('p256-webauthn'),
    readerPublicKey: '11'.repeat(32),
    devicePublicKey: '02' + '22'.repeat(32),
    policy: { rp_id_hash: bytes, origin: new Uint8Array(21) },
  };
  await createAccountAuthorisation(f.options).run(
    { route: 'primary', flow: { kind: 'add-device', reader } },
    async (_account, approved) => {
      assert.equal(approved.flow.reader?.policy?.rp_id_hash.byteLength, 32);
      assert.deepEqual(approved.flow.reader?.policy?.rp_id_hash, new Uint8Array(32).fill(4));
    },
  );
  assert.equal(iterated, 0);
  for (const rp_id_hash of [
    shadow(new Uint8Array(33), 32),
    new Proxy(new Uint8Array(32), {}),
    new Proxy(new Uint8Array(32), {
      getPrototypeOf() {
        throw Error('private policy proxy');
      },
    }),
  ])
    await assert.rejects(
      createAccountAuthorisation(f.options).run(
        {
          route: 'primary',
          flow: {
            kind: 'add-device',
            reader: { ...reader, policy: { ...reader.policy, rp_id_hash } },
          },
        },
        async () => {
          throw Error('must not dispatch');
        },
      ),
      invalid,
    );
  assert.equal(f.reviews.length, 1);
});
