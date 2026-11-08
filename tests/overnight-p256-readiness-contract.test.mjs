// Actual software WebAuthn and generated challenges, without native proofs/provider acceptance.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPassportAccounts } from '../packages/account/dist/index.js';
import { readinessFixture, readinessHost } from './fixtures/overnight-p256-readiness-fixture.mjs';
import { authenticateSealedReader } from '../packages/account/dist/p256-sealed-reader.js';
import { isP256, isSealedP256 } from '../packages/account/dist/p256-device.js';

test('creation retains strict verification, original material and the exact readiness Flow transcript', async () => {
  const f = readinessFixture();
  const account = await f.create();
  const record = f.hint();
  assert.equal(account.address, record.address);
  assert.equal(f.auth.creates.length, 1);
  assert.deepEqual(
    f.trace.filter((value) => value.startsWith('ceremony:')),
    ['ceremony:create', 'ceremony:verify-created', 'ceremony:sign', 'ceremony:sign'],
  );
  assert.deepEqual(f.sessions, [
    { kind: 'create-account', lockAccount: true },
    { kind: 'sign-in', account: account.address },
    { kind: 'sign-in', account: account.address },
  ]);
  assert.deepEqual(
    f.trace.filter((value) =>
      /^(material|deploy|directory:|call:|authenticate:|record:)/.test(value),
    ),
    [
      'material',
      'deploy',
      'directory:deployed',
      'authenticate:2',
      'call:activate',
      'call:append1',
      'call:append2',
      'authenticate:1',
      'directory:active',
      'record:write',
    ],
  );
  assert.deepEqual(
    f.events
      .filter((event) => event.phase === 'start' && !event.id.startsWith('fake-'))
      .map((event) => event.step),
    [
      'passkey.create',
      'passkey.prf',
      'deploy',
      'directory.write',
      'activate',
      'counter.scan',
      'counter.scan',
      'passkey.sign',
      'counter.scan',
      'passkey.sign',
      'directory.write',
      'counter.scan',
    ],
  );
  assert.equal(new Set(f.events.map((event) => event.flowId)).size, 1);
  assert.deepEqual(f.ledger().inboxEntries, record.keyEntries);
  assert.equal(f.materials.length, 1);
  for (const call of f.calls) {
    assert.equal(call.signal, f.options.signal);
    assert.equal(call.onEvent, f.calls[0]?.onEvent);
  }
  assert.equal(f.calls[0]?.args[1], record.salt);
  assert.equal(f.calls[1]?.args[0], record.keyEntries?.[0]);
  assert.equal(f.calls[2]?.args[0], record.keyEntries?.[1]);
});

for (const boundary of [
  'activate:after',
  'append1:before',
  'append1:after',
  'append2:before',
  'append2:after',
]) {
  test(`explicit open after ${boundary} adopts only landed original creation effects`, async () => {
    const f = readinessFixture();
    f.fault.boundary = boundary;
    await assert.rejects(f.create(), { code: f.unknown.code, message: f.unknown.message });
    const pending = f.hint();
    assert.equal(pending.status, 'deployed');
    const salt = pending.salt;
    const entries = pending.keyEntries;
    const alreadyHeld = [...f.ledger().inboxEntries];
    const previous = f.calls.length;
    const creates = f.auth.creates.length;
    f.fault.boundary = '';
    f.viewingKey.createKeys = async () => {
      throw new Error('replacement material forbidden');
    };
    const api = createPassportAccounts({
      ...f.ports,
      deployer: {
        deploy: async () => {
          throw new Error('redeploy forbidden');
        },
      },
    });
    const opened = await api.openAccount();
    assert.equal(opened.address, pending.address);
    assert.equal(f.auth.creates.length, creates);
    assert.equal(f.hint().salt, salt);
    assert.equal(f.hint().keyEntries, entries);
    assert.deepEqual(f.ledger().inboxEntries, entries);
    assert.equal(
      f.calls.filter((call) => call.circuit === 'activate_initial_device_with_p256').length,
      1,
    );
    const resumed = f.calls.slice(previous);
    assert.equal(resumed.length, 2 - alreadyHeld.length);
    assert.deepEqual(
      resumed.map((call) => call.args[0]),
      entries?.slice(alreadyHeld.length),
    );
    assert.equal(f.hint().status, 'active');
  });
}

for (const signature of ['counter', 'key']) {
  test(`a ${signature} mismatch refuses publication before a chain send`, async () => {
    const f = readinessFixture();
    f.fault.signature = signature;
    await assert.rejects(f.create(), {
      code: 'NotAuthorised',
      message: 'The signature names another device.',
    });
    assert.deepEqual(
      f.calls.map((call) => call.circuit),
      ['activate_initial_device_with_p256'],
    );
    assert.equal(f.hint().status, 'deployed');
    assert.equal(f.ledger().inboxEntries.length, 0);
  });
}

test('pending registration is authenticated before activation, with its original cause', async () => {
  const f = readinessFixture();
  f.fault.boundary = 'activate:before';
  await assert.rejects(f.create(), { code: f.unknown.code, message: f.unknown.message });
  const host = readinessHost(f);
  const record = f.hint();
  const view = await f.chain.readAccount(record.address, { includeInbox: true });
  assert.ok(view);
  const keys = f.materials[0];
  assert.ok(keys);
  const original = f.viewingKey.openInbox;
  f.viewingKey.openInbox = async (...args) => {
    const opened = [...(await original.call(f.viewingKey, ...args))];
    const device = opened[1];
    assert.ok(device?.kind === 'device');
    opened[1] = {
      ...device,
      device: { ...device.device, devicePublicKey: '02' + '00'.repeat(32) },
    };
    return opened;
  };
  const calls = f.calls.length;
  await assert.rejects(authenticateSealedReader(host, record, view, true), (error) => {
    assert.ok(error instanceof Error && 'code' in error);
    assert.equal(error.code, 'EncryptionKeyMismatch');
    assert.ok(error.cause instanceof Error);
    assert.equal(error.cause.message, 'the sealed registration does not name this device');
    return true;
  });
  assert.equal(f.calls.length, calls);
});

test('reader method capture and dynamic owner-session lookup preserve their receivers', async () => {
  const f = readinessFixture();
  await f.create();
  const record = f.hint();
  const view = await f.chain.readAccount(record.address, { includeInbox: true });
  assert.ok(view);
  const host = readinessHost(f);
  const originalHex = f.authoriser.devicePublicKeyHex;
  assert.ok(originalHex);
  let captured = 0,
    replacement = 0;
  f.authoriser.devicePublicKeyHex = async function () {
    assert.equal(this, f.authoriser);
    captured++;
    return originalHex.call(this);
  };
  f.authoriser.withKeySession = async function (work, descriptor) {
    assert.equal(this, f.authoriser);
    assert.deepEqual(descriptor, { kind: 'sign-in', account: record.address });
    f.authoriser.devicePublicKeyHex = async () => {
      replacement++;
      throw new Error('late replacement');
    };
    return work();
  };
  await authenticateSealedReader(host, record, view, true);
  assert.equal(captured, 1);
  assert.equal(replacement, 0);
  f.authoriser.withKeySession = async () => {
    throw new Error('nested session forbidden');
  };
  await authenticateSealedReader(host, record, view, false, true);
  assert.equal(replacement, 0);
});

test('factory directory reference is retained while its methods remain dynamic', async () => {
  const f = readinessFixture();
  await f.create();
  const api = createPassportAccounts(f.ports);
  const originalGet = f.directory.get;
  let gets = 0;
  f.directory.get = async function (...args) {
    assert.equal(this, f.directory);
    gets++;
    return originalGet.apply(this, args);
  };
  const changed = {
    ...f.ports,
    directory: {
      get: async () => {
        throw new Error('replacement directory forbidden');
      },
      put: async () => {},
    },
  };
  Object.assign(f.ports, { directory: changed.directory });
  assert.equal((await api.openAccount()).address, f.hint().address);
  assert.equal(gets, 1);
});

test('custom mutable pending hints retain legacy late batch and publication property lookups', async () => {
  const f = readinessFixture();
  /** @type {ReturnType<typeof f.hint> | undefined} */ let pending;
  const originalPut = f.directory.put;
  f.directory.put = async function (network, record) {
    if (record.status === 'deployed') {
      assert.ok(isP256(record) && isSealedP256(record));
      pending = record;
    }
    return originalPut.call(this, network, record);
  };
  const originalSession = f.authoriser.withKeySession;
  assert.ok(originalSession);
  /** @type {readonly Uint8Array[] | undefined} */ let originalEntries;
  /** @type {readonly Uint8Array[] | undefined} */ let sessionEntries;
  /** @type {readonly Uint8Array[] | undefined} */ let activationEntries;
  f.authoriser.withKeySession = async function (work, descriptor) {
    if (descriptor?.kind === 'sign-in' && !sessionEntries) {
      assert.ok(pending);
      originalEntries = pending.keyEntries;
      assert.ok(originalEntries);
      sessionEntries = originalEntries.map((entry) => Uint8Array.from(entry));
      // Deliberately violates the readonly host contract to pin the pre-extraction boundary.
      Object.assign(pending, { keyEntries: sessionEntries });
    }
    return originalSession.bind(this)(work, descriptor);
  };
  const originalOpen = f.viewingKey.openInbox;
  let authentications = 0;
  f.viewingKey.openInbox = async function (network, ring, batch) {
    if (authentications++ === 0) {
      assert.equal(batch, sessionEntries, 'batch lookup occurs inside the selected key session');
      assert.equal(
        ring.envelopes[0],
        originalEntries?.[1],
        'search was formed before entering that session',
      );
    }
    return originalOpen.call(this, network, ring, batch);
  };
  const originalCall = f.chain.call;
  f.chain.call = async function (request) {
    const receipt = await originalCall.call(this, request);
    if (request.circuit === 'activate_initial_device_with_p256') {
      assert.ok(sessionEntries);
      activationEntries = sessionEntries.map((entry) => Uint8Array.from(entry));
      assert.ok(pending);
      Object.assign(pending, { keyEntries: activationEntries });
    }
    return receipt;
  };
  await f.create();
  assert.ok(activationEntries);
  assert.equal(f.calls[1]?.args[0], activationEntries[0]);
  assert.equal(f.calls[2]?.args[0], activationEntries[1]);
  assert.equal(f.hint().keyEntries, activationEntries);
  assert.equal(f.calls.length, 3);
  assert.equal(f.materials.length, 1);
});
