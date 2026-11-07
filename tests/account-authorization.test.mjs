import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createAccountAuthorisation,
  routeAuthenticatedAccount,
} from '../packages/account/dist/authorization.js';

/** @param {string} [scheme] */
const account = (scheme = 'p256-webauthn') =>
  /** @type {import('../packages/protocol/dist/index.js').PassportAccount} */ (
    /** @type {unknown} */ ({
      address: 'ab'.repeat(32),
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      scheme,
      state: async () => ({ authNonce: 1n }),
    })
  );
function fixture() {
  const primary = account(),
    owner = account('jubjub-schnorr');
  let valid = true;
  const lease = {
    account: owner,
    check() {
      if (!valid) throw Error('locked');
    },
  };
  let current = lease;
  const reviews =
    /** @type {import('../packages/account/dist/authorization.js').AccountConsent[]} */ ([]);
  const options = {
    primary,
    authenticated: () => current,
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
    lock() {
      valid = false;
    },
    replace() {
      current = { account: owner, check() {} };
    },
  };
}
const flow = /** @type {const} */ ({
  kind: 'withdraw-unshielded',
  color: '00'.repeat(32),
  amount: '1',
  recipient: 'cd'.repeat(32),
});

test('one approved route selects one matching account and never mixes authorization schemes', async () => {
  const f = fixture();
  const router = createAccountAuthorisation(f.options);
  assert.equal(await router.run({ route: 'primary', flow }, async (a) => a), f.primary);
  assert.equal(await router.run({ route: 'authenticated-owner', flow }, async (a) => a), f.owner);
  assert.deepEqual(
    f.reviews.map((r) => r.scheme),
    ['p256-webauthn', 'jubjub-schnorr'],
  );
  assert.equal(f.reviews[1]?.context.account, f.primary.address);
  assert.equal(f.reviews[1]?.flow.account, f.primary.address);
});

test('decline, expiry during consent and lease replacement cause no dispatch or passkey fallback', async () => {
  for (const failure of ['decline', 'lock', 'replace']) {
    const f = fixture();
    let dispatch = 0;
    f.options.consent.review = async () => {
      if (failure === 'lock') f.lock();
      if (failure === 'replace') f.replace();
      return failure !== 'decline';
    };
    await assert.rejects(
      createAccountAuthorisation(f.options).run(
        { route: 'authenticated-owner', flow },
        async () => {
          dispatch++;
        },
      ),
      failure === 'lock' ? /locked/ : { code: failure === 'decline' ? 'Declined' : 'Unavailable' },
    );
    assert.equal(dispatch, 0);
  }
});

test('private reads check lease after completion, while dispatched mutation receipts survive expiry', async () => {
  let f = fixture();
  await assert.rejects(
    createAccountAuthorisation(f.options).run(
      { route: 'authenticated-owner', flow: { kind: 'read-holdings' } },
      async () => {
        f.lock();
        return 'private';
      },
    ),
    /locked/,
  );
  f = fixture();
  assert.deepEqual(
    await createAccountAuthorisation(f.options).run(
      { route: 'authenticated-owner', flow },
      async () => {
        f.lock();
        return { txHash: 'submitted' };
      },
    ),
    { txHash: 'submitted' },
  );
});

test('wrong account, malformed flow and missing authenticated owner refuse before consent', async () => {
  const f = fixture();
  const router = createAccountAuthorisation(f.options);
  for (const descriptor of [
    { ...flow, account: 'cd'.repeat(32) },
    { kind: 'create-account' },
    { ...flow, amount: '1e9' },
    { ...flow, color: 'bad' },
  ]) {
    await assert.rejects(
      router.run(
        {
          route: 'authenticated-owner',
          flow: /** @type {import('../packages/account/dist/ports/index.js').FlowDescriptor} */ (
            descriptor
          ),
        },
        async () => {},
      ),
      { code: 'InvalidContext' },
    );
  }
  const other = account('jubjub-schnorr');
  Object.defineProperty(other, 'address', { value: 'cd'.repeat(32) });
  await assert.rejects(
    createAccountAuthorisation({
      ...f.options,
      authenticated: () => ({ account: other, check() {} }),
    }).run({ route: 'authenticated-owner', flow }, async () => {}),
    { code: 'InvalidContext' },
  );
  await assert.rejects(
    createAccountAuthorisation({ primary: f.primary, consent: f.options.consent }).run(
      { route: 'authenticated-owner', flow },
      async () => {},
    ),
    { code: 'Unavailable' },
  );
  assert.equal(f.reviews.length, 0);
});

test('review receives an isolated public descriptor without provider extensions', async () => {
  const f = fixture();
  const scope = {
    grantee: { scheme: /** @type {const} */ ('jubjub-schnorr'), publicKey: '11'.repeat(32) },
    operations: /** @type {const} */ (['withdraw-unshielded']),
    color: '00'.repeat(32),
    recipient: { kind: /** @type {const} */ ('any') },
    maxCoinValue: '1',
    perCallCap: '1',
    cap: '5',
    expiresAt: 123,
  };
  const descriptor = {
    kind: /** @type {const} */ ('issue-grant'),
    scope,
    devices: ['22'.repeat(32)],
    privateExtension: 'secret',
  };
  f.options.consent.review = async (request) => {
    assert.equal('privateExtension' in request.flow, false);
    assert.notEqual(request.flow.scope, scope);
    assert.ok(request.flow.devices);
    /** @type {string[]} */ (request.flow.devices).push('33'.repeat(32));
    return true;
  };
  await createAccountAuthorisation(f.options).run(
    { route: 'authenticated-owner', flow: descriptor },
    async () => {},
  );
  assert.equal(descriptor.devices.length, 1);
});

test('compatibility routing pins extracted methods and leaves public reconciliation available', async () => {
  const f = fixture();
  let selected = f.owner;
  const routed = routeAuthenticatedAccount(
    f.primary,
    () => selected,
    () => f.lease.check(),
  );
  f.owner.rotateViewingKey = async () => ({
    txHash: 'one',
    droppedDeviceEntries: [],
    sealedReadGrants: [],
    unsealedGrantIds: [],
  });
  const operation = routed.rotateViewingKey;
  assert.ok(operation);
  selected = account('jubjub-schnorr');
  assert.throws(() => operation(), { code: 'Unavailable' });
  f.lock();
  assert.equal((await routed.state()).authNonce, 1n);
  assert.throws(() => operation(), /locked/);
});

test('operation receives the approved public snapshot even if caller fields change during review', async () => {
  const f = fixture();
  const mutable = { ...flow, amount: String(flow.amount) };
  f.options.consent.review = async () => {
    mutable.amount = '99';
    return true;
  };
  await createAccountAuthorisation(f.options).run(
    { route: 'authenticated-owner', flow: mutable },
    async (selected, approved) => {
      assert.equal(selected, f.owner);
      assert.equal(approved.flow.amount, '1');
    },
  );
  const next = fixture();
  await assert.rejects(
    createAccountAuthorisation(next.options).run(
      { route: 'authenticated-owner', flow: { kind: 'read-holdings' } },
      async () => {
        next.replace();
        return 'private';
      },
    ),
    { code: 'Unavailable' },
  );
});

test('value and permission reviews refuse incomplete effects before opening a consent UI', async () => {
  const f = fixture();
  const router = createAccountAuthorisation(f.options);
  for (const descriptor of [
    { kind: 'withdraw-unshielded' },
    { ...flow, amount: '0' },
    { ...flow, kind: 'withdraw-shielded' },
    { kind: 'issue-grant' },
    { kind: 'revoke-grant' },
    { kind: 'add-device' },
    { kind: 'remove-device' },
  ])
    await assert.rejects(
      router.run(
        {
          route: 'primary',
          flow: /** @type {import('../packages/account/dist/ports/index.js').FlowDescriptor} */ (
            descriptor
          ),
        },
        async () => {},
      ),
      { code: 'InvalidContext' },
    );
  assert.equal(f.reviews.length, 0);
});
