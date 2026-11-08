// Actual account/WebAuthn ES256 crypto, synthetic credentials and chain only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPassportAccounts, PassportConnectorError } from '../packages/account/dist/index.js';
import { createFakePorts } from '../packages/account/dist/testing/index.js';
import { webauthnPasskey, webauthnPolicy } from '../packages/adapter-webauthn/dist/index.js';
import { recipeDeviceKeyring } from '../packages/keys/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { softwareAuthenticator, ORIGIN, RP, ID } from './fixtures/software-authenticator.mjs';

const transfer = { color: '01'.repeat(32), amount: '7', recipient: '02'.repeat(32) };
/** @typedef {import('../packages/adapter-webauthn/dist/ceremony.js').PasskeyCeremony} Ceremony */
/** @typedef {import('../packages/account/dist/ports/index.js').CallRequest} CallRequest */
/** @typedef {import('../packages/account/dist/ports/index.js').FlowDescriptor} FlowDescriptor */
const deferred = () => {
  /** @type {() => void} */
  let resolve = () => {};
  const promise = new Promise((yes) => {
    resolve = () => yes(undefined);
  });
  return { promise, resolve };
};
async function setup() {
  const auth = softwareAuthenticator({ atCreate: 'results' });
  const fake = createFakePorts({ binding: { pureCircuits } });
  /** @type {Ceremony[]} */
  const purposes = [];
  /** @type {CallRequest[]} */
  const calls = [];
  /** @type {(FlowDescriptor | undefined)[]} */
  const descriptors = [];
  /** @type {{ review: (ceremony: Ceremony) => Promise<void>; denySession: boolean; nativeCancel: boolean; wrongId: boolean; badSignature: boolean }} */
  const control = {
    review: async () => {},
    denySession: false,
    nativeCancel: false,
    wrongId: false,
    badSignature: false,
  };
  const container = {
    ...auth.container,
    async get(/** @type {Parameters<typeof auth.container.get>[0]} */ options) {
      assert.equal(this, container, 'captured get retains its original receiver');
      if (control.nativeCancel)
        throw Object.assign(new Error('Dismissed'), { name: 'NotAllowedError' });
      const got = await auth.container.get(options);
      assert.ok(got);
      if (control.wrongId) return { ...got, rawId: Uint8Array.of(9).buffer };
      if (control.badSignature)
        return {
          ...got,
          response: {
            ...got.response,
            signature: Uint8Array.of(0x30, 6, 2, 1, 1, 2, 1, 1).buffer,
          },
        };
      return got;
    },
  };
  const options = {
    rpId: RP,
    origin: ORIGIN,
    credentials: container,
    beforeCeremony: async (/** @type {Ceremony} */ ceremony) => {
      purposes.push(ceremony);
      await control.review(ceremony);
    },
  };
  const adapter = webauthnPasskey(options);
  assert.ok(
    adapter.p256.withKeySession &&
      adapter.p256.deviceBinding &&
      adapter.credentials.withLoginSession,
  );
  const keySession = adapter.p256.withKeySession.bind(adapter.p256);
  const binding = adapter.p256.deviceBinding.bind(adapter.p256);
  const login = adapter.credentials.withLoginSession.bind(adapter.credentials);
  const account = await createPassportAccounts({
    ...fake,
    network: { ...fake.network, bindingId: 'acc-s3r1.1' },
    credentials: adapter.credentials,
    authoriser: {
      ...adapter.p256,
      /** @template T @param {() => Promise<T>} work @param {FlowDescriptor | undefined} flow */
      async withKeySession(work, flow) {
        descriptors.push(flow);
        if (control.denySession) throw new PassportConnectorError('UserCancelled', 'Host refused');
        return keySession(work, flow);
      },
    },
    viewingKey: recipeDeviceKeyring(adapter.prf),
    chain: {
      ...fake.chain,
      async call(/** @type {CallRequest} */ request) {
        if (request.circuit === 'withdraw_unshielded_with_p256') {
          calls.push(request);
          return { txHash: `withdraw-${calls.length}` };
        }
        return fake.chain.call(request);
      },
    },
  }).createAccount({ userName: 'sign-only', retireAuthority: true });
  const ledger = fake.ledger.get(account.address);
  assert.ok(ledger && account.withdrawUnshielded);
  ledger.specVersion = 3;
  const withdraw = account.withdrawUnshielded;
  const before = auth.gets.length;
  purposes.length = 0;
  descriptors.length = 0;
  return {
    withdraw,
    binding,
    keySession,
    login,
    ledger,
    auth,
    fake,
    adapter,
    account,
    purposes,
    calls,
    control,
    descriptors,
    before,
    container,
    options,
  };
}

test('actual P-256 unshielded withdrawal uses one fresh strict sign and no PRF fallback', async () => {
  const w = await setup();
  w.auth.prfControl.unavailable = true;
  const request = { ...transfer };
  const pending = w.withdraw(request);
  request.amount = '999';
  request.recipient = 'ff'.repeat(32);
  const result = await pending;
  assert.equal(result.txHash, 'withdraw-1');
  assert.equal(w.auth.gets.length - w.before, 1);
  assert.deepEqual(
    w.purposes.map((value) => value.purpose),
    ['sign'],
  );
  assert.deepEqual(w.descriptors, [
    { kind: 'withdraw-unshielded', account: w.account.address, ...transfer },
  ]);
  const assertion = w.auth.gets.at(-1);
  assert.ok(assertion && assertion.allowCredentials?.[0]);
  assert.equal(assertion.extensions, undefined);
  assert.equal(assertion.userVerification, 'required');
  assert.deepEqual(assertion.allowCredentials[0].id, ID);
  const call = w.calls[0];
  assert.ok(call);
  assert.deepEqual(call.args.slice(0, 3), [
    Uint8Array.from(Buffer.from(transfer.color, 'hex')),
    7n,
    { bytes: Uint8Array.from(Buffer.from(transfer.recipient, 'hex')) },
  ]);
  const hint = [...w.fake.directory.hints.values()][0];
  assert.ok(hint);
  const challenge = pureCircuits.challenge_withdraw_unshielded_with_p256(
    { bytes: Buffer.from(w.account.address, 'hex') },
    { ...hint.publicKey, identity: false },
    Buffer.from(transfer.color, 'hex'),
    7n,
    { bytes: Buffer.from(transfer.recipient, 'hex') },
    w.ledger.authNonce,
  );
  assert.deepEqual(assertion.challenge, challenge);
  const approval = call.args[3];
  assert.ok(
    approval &&
      typeof approval === 'object' &&
      'authenticator_data' in approval &&
      approval.authenticator_data instanceof Uint8Array,
  );
  assert.equal(approval.authenticator_data.length, 37);
  await w.withdraw(transfer);
  assert.equal(
    w.auth.gets.length - w.before,
    2,
    'a second transaction needs another fresh assertion',
  );
});

test('generic session refusal and actual sign-review refusal prevent every credential and dispatch', async () => {
  for (const refusal of ['session', 'review']) {
    const w = await setup();
    if (refusal === 'session') w.control.denySession = true;
    else
      w.control.review = async () => {
        throw new PassportConnectorError('UserCancelled', 'Declined');
      };
    await assert.rejects(w.withdraw(transfer), { code: 'UserCancelled' });
    assert.equal(w.auth.gets.length, w.before);
    assert.equal(w.calls.length, 0);
    assert.equal(w.descriptors.length, 1);
  }
});

test('native dismissal and invalid strict material never derive or dispatch', async () => {
  for (const fault of [
    'cancel',
    'flags',
    'rp',
    'challenge',
    'extensions',
    'wrong-id',
    'signature',
  ]) {
    const w = await setup();
    if (fault === 'cancel') w.control.nativeCancel = true;
    if (fault === 'wrong-id') w.control.wrongId = true;
    if (fault === 'signature') w.control.badSignature = true;
    if (fault === 'flags') w.auth.behaviour.flags = 1;
    if (fault === 'rp') w.auth.behaviour.rp = 'example.org';
    if (fault === 'challenge') w.auth.behaviour.wrongChallenge = true;
    if (fault === 'extensions') w.auth.behaviour.extensionData = true;
    await assert.rejects(w.withdraw(transfer));
    assert.equal(w.calls.length, 0);
    assert.deepEqual(
      w.purposes.map((value) => value.purpose),
      ['sign'],
    );
  }
});

for (const refuse of [false, true]) {
  test(`strict signing retry remains fresh and separately ${refuse ? 'refusable' : 'approved'}`, async () => {
    const w = await setup();
    w.auth.grease.remaining = 1;
    w.control.review = async ({ attempt }) => {
      if (refuse && attempt === 2) throw new PassportConnectorError('UserCancelled', 'No retry');
    };
    if (refuse) await assert.rejects(w.withdraw(transfer), { code: 'UserCancelled' });
    else await w.withdraw(transfer);
    assert.deepEqual(
      w.purposes.map(({ purpose, attempt }) => [purpose, attempt]),
      [
        ['sign', 1],
        ['sign', 2],
      ],
    );
    assert.equal(w.auth.gets.length - w.before, refuse ? 1 : 2);
    assert.equal(w.calls.length, refuse ? 0 : 1);
    assert.ok(w.auth.gets.slice(w.before).every((request) => request.extensions === undefined));
  });
}

test('owned public binding snapshots cannot mutate the selected passkey', async () => {
  const w = await setup();
  const binding = await w.binding();
  binding.credentialId.fill(9);
  binding.policy.origin.fill(0);
  binding.policy.rp_id_hash.fill(0);
  const point = await w.adapter.p256.devicePublicKey();
  Reflect.set(point, 'x', 1n);
  await w.withdraw(transfer);
  assert.equal(w.auth.gets.length - w.before, 1);
});

test('lazy transaction ownership blocks selection/login and old owns while review is pending', async () => {
  const w = await setup();
  const identity = await w.adapter.credentials.identify();
  assert.ok(identity.owns(await w.adapter.p256.devicePublicKey(), webauthnPolicy(RP, ORIGIN)));
  const gate = deferred();
  const entered = deferred();
  w.control.review = async () => {
    entered.resolve();
    await gate.promise;
  };
  const before = w.auth.gets.length;
  const pending = w.withdraw(transfer);
  await entered.promise;
  await assert.rejects(w.adapter.credentials.create({ name: 'overlap' }), {
    code: 'NotAuthorised',
  });
  await assert.rejects(w.adapter.credentials.identify(), { code: 'NotAuthorised' });
  await assert.rejects(
    w.login(async () => {}),
    { code: 'NotAuthorised' },
  );
  assert.equal(
    identity.owns(await w.adapter.p256.devicePublicKey(), webauthnPolicy(RP, ORIGIN)),
    false,
  );
  assert.equal(w.auth.gets.length, before);
  gate.resolve();
  await pending;
  assert.equal(w.auth.gets.length, before + 1);
  w.control.review = async () => {};
  const newer = await w.adapter.credentials.identify();
  assert.equal(
    identity.owns(await w.adapter.p256.devicePublicKey(), webauthnPolicy(RP, ORIGIN)),
    false,
  );
  assert.ok(newer.owns(await w.adapter.p256.devicePublicKey(), webauthnPolicy(RP, ORIGIN)));
});

test('injected receiver/method and options remain pinned through actual signature approval', async () => {
  const w = await setup();
  w.control.review = async () => {
    w.container.get = async () => assert.fail('Replaced receiver method');
    Reflect.set(w.options, 'credentials', softwareAuthenticator().container);
    w.options.rpId = 'example.org';
  };
  await w.withdraw(transfer);
  assert.equal(w.auth.gets.length - w.before, 1);
});

for (const kind of ['create', 'identify']) {
  test(`in-flight ${kind} refuses reverse lazy and eager key-scope entry`, async () => {
    const w = await setup();
    const gate = deferred();
    const entered = deferred();
    w.control.review = async () => {
      entered.resolve();
      await gate.promise;
    };
    const before = w.auth.gets.length;
    const selecting =
      kind === 'create'
        ? w.adapter.credentials.create({ name: 'reverse-overlap' })
        : w.adapter.credentials.identify();
    await entered.promise;
    await assert.rejects(
      w.keySession(async () => assert.fail(), {
        kind: 'withdraw-unshielded',
        account: w.account.address,
        ...transfer,
      }),
      { code: 'NotAuthorised' },
    );
    await assert.rejects(w.adapter.prf.deviceSecret(), { code: 'NotAuthorised' });
    assert.equal(w.auth.gets.length, before);
    gate.resolve();
    await selecting;
    w.control.review = async () => {};
    await w.withdraw(transfer);
  });
}

test('ordinary eager PRF ownership also blocks credential selection until teardown', async () => {
  const w = await setup();
  const gate = deferred();
  const entered = deferred();
  const owner = w.adapter.prf.withSession(async () => {
    entered.resolve();
    await gate.promise;
  });
  await entered.promise;
  const before = w.auth.gets.length;
  await assert.rejects(w.adapter.credentials.identify(), { code: 'NotAuthorised' });
  await assert.rejects(w.adapter.credentials.create({ name: 'overlap' }), {
    code: 'NotAuthorised',
  });
  assert.equal(w.auth.gets.length, before);
  gate.resolve();
  await owner;
  await w.adapter.credentials.identify();
});

test('nonwithdrawal and explicitly requested nested PRF work remain eager and reviewed', async () => {
  const w = await setup();
  await w.keySession(async () => {}, { kind: 'read-holdings', account: w.account.address });
  await w.keySession(
    async () => {
      (await w.adapter.prf.deviceSecret()).fill(0);
    },
    { kind: 'withdraw-unshielded', account: w.account.address, ...transfer },
  );
  assert.deepEqual(
    w.purposes.map(({ purpose }) => purpose),
    ['derive-keys', 'derive-keys'],
  );
  assert.equal(w.auth.gets.length - w.before, 2);
});

test('wrong credential and pre-aborted withdrawal refuse before native access or dispatch', async () => {
  const w = await setup();
  await assert.rejects(
    w.adapter.p256.authorise({
      account: w.account.address,
      circuit: 'withdraw_unshielded_with_p256',
      args: [],
      witnessValues: [],
      authNonce: 0n,
      useCounter: 0n,
      credentialId: Uint8Array.of(9),
      challenge: new Uint8Array(32),
    }),
    { code: 'NotAuthorised' },
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(w.withdraw(transfer, { signal: controller.signal }), { code: 'Aborted' });
  assert.equal(w.auth.gets.length, w.before);
  assert.equal(w.calls.length, 0);
});

test('selected-login nesting retains its one login request and requires a fresh transaction sign', async () => {
  const w = await setup();
  await w.login(async () => {
    const identity = await w.adapter.credentials.identify();
    assert.ok(identity.owns(await w.adapter.p256.devicePublicKey(), webauthnPolicy(RP, ORIGIN)));
    await w.withdraw(transfer);
  });
  assert.equal(w.auth.gets.length - w.before, 2);
  assert.deepEqual(
    w.purposes.map(({ purpose }) => purpose),
    ['identify-and-unlock', 'sign'],
  );
  assert.equal(w.calls.length, 1);
});

test('binding admission cannot adopt an old identity if copying policy starts a new selector', async () => {
  const w = await setup();
  const identity = await w.adapter.credentials.identify();
  const point = await w.adapter.p256.devicePublicKey();
  const policy = webauthnPolicy(RP, ORIGIN);
  let selecting = Promise.resolve(identity);
  const reentrant = {
    get rp_id_hash() {
      selecting = w.adapter.credentials.identify();
      return policy.rp_id_hash;
    },
    origin: policy.origin,
  };
  assert.equal(identity.owns(point, reentrant), false);
  const newer = await selecting;
  assert.ok(newer.owns(point, policy));
  await w.withdraw(transfer);
});

test('abandoned selected login refuses a paused nested signature before native access', async () => {
  const w = await setup();
  const entered = deferred();
  const gate = deferred();
  /** @type {Promise<unknown>} */
  let child = Promise.resolve();
  w.control.review = async ({ purpose }) => {
    if (purpose === 'sign') {
      entered.resolve();
      await gate.promise;
    }
  };
  await w.login(async () => {
    const identity = await w.adapter.credentials.identify();
    assert.ok(identity.owns(await w.adapter.p256.devicePublicKey(), webauthnPolicy(RP, ORIGIN)));
    child = w.withdraw(transfer);
    void child.catch(() => {});
    await entered.promise;
  });
  const refused = assert.rejects(child, { code: 'NotAuthorised' });
  gate.resolve();
  await refused;
  assert.equal(w.auth.gets.length - w.before, 1, 'only the login assertion reached the provider');
  assert.equal(w.calls.length, 0);
});

test('a caught nested PRF refusal cannot continue an already paused signature', async () => {
  const w = await setup();
  w.auth.prfControl.cancelled = true;
  w.control.review = async ({ purpose }) => {
    if (purpose === 'sign')
      await assert.rejects(w.adapter.prf.deviceSecret(), { code: 'UserCancelled' });
  };
  await assert.rejects(w.withdraw(transfer), { code: 'UserCancelled' });
  assert.equal(
    w.auth.gets.length - w.before,
    1,
    'only the explicitly requested PRF read reached the provider',
  );
  assert.equal(w.calls.length, 0);
  w.control.review = async () => {};
  await w.withdraw(transfer);
  assert.equal(w.auth.gets.length - w.before, 2, 'a new explicit transaction can sign without PRF');
});
