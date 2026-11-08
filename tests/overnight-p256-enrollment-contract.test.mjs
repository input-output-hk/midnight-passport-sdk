// Public connector contracts with software P-256 signatures, real keyring recipes and a fake chain.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPassportAccounts } from '../packages/account/dist/index.js';
import { PassportConnectorError } from '../packages/account/dist/errors.js';
import {
  createFakePorts,
  fakeAuthoriser,
  FAKE_POLICY,
} from '../packages/account/dist/testing/index.js';
import { recipeDeviceKeyring, recipeJubjubAuthoriser } from '../packages/keys/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { x25519 } from '@noble/curves/ed25519.js';

const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString('hex');
const keyring = (value = 9) =>
  recipeDeviceKeyring({
    withSession: (work) => work(),
    deviceSecret: async () => new Uint8Array(32).fill(value),
    deriveSecret: async () => new Uint8Array(32).fill(value),
  });

/** @param {{ scheme?: 'p256'|'jubjub'; readGrant?: boolean }} [options] */
async function fixture({ scheme = 'p256', readGrant = false } = {}) {
  const fake = createFakePorts({ binding: { pureCircuits } });
  const baseKeyring = keyring();
  const originalBinding = fake.authoriser.deviceBinding;
  assert.ok(originalBinding);
  let recording = false,
    locked = false,
    lockAfterSubmit = false;
  let appendCount = 0;
  /** @type {'credential'|'rp'|'origin'|undefined} */
  let bindingFault;
  /** @type {'key'|'epoch'|'roster'|undefined} */
  let deliveryTamper;
  /** @type {'key'|'epoch'|'roster'|undefined} */
  let beforeRotationTamper;
  let missingRoster = false;
  /** @type {'nonce-only'|'target-only'|undefined} */
  let settlementFault;
  let submitted = false,
    settlementReads = 0;
  let targetHex = '';
  /** @type {'envelope'|'registration'|'enrollment'|undefined} */
  let unknownAt;
  const unknown = new PassportConnectorError(
    'MutationUnsettled',
    'original enrollment request 012345 is unknown',
  );
  const trace = /** @type {string[]} */ ([]);
  const calls = /** @type {import('../packages/account/dist/ports/index.js').CallRequest[]} */ ([]);
  const signed =
    /** @type {import('../packages/account/dist/ports/index.js').AuthorisationRequest[]} */ ([]);
  const scopes =
    /** @type {Array<import('../packages/account/dist/ports/index.js').FlowDescriptor|undefined>} */ ([]);
  const deliveries =
    /** @type {import('../packages/account/dist/ports/index.js').LiveDeviceReader[]} */ ([]);
  const deliveryKeys = /** @type {string[]} */ ([]);
  const events = /** @type {import('../packages/protocol/dist/index.js').PassportEvent[]} */ ([]);
  const receipts =
    /** @type {import('../packages/protocol/dist/index.js').PassportTxResult[]} */ ([]);
  const ledger = () => {
    const value = [...fake.ledger.values()][0];
    assert.ok(value);
    return value;
  };
  /** @type {import('../packages/account/dist/ports/index.js').Authoriser} */
  const authoriser = {
    ...fake.authoriser,
    async withKeySession(work, scope) {
      assert.equal(this, authoriser);
      if (recording) scopes.push(scope);
      if (recording && beforeRotationTamper) {
        if (beforeRotationTamper === 'key') ledger().encKey = new Uint8Array(32).fill(4);
        else if (beforeRotationTamper === 'epoch') ledger().deviceEpoch++;
        else ledger().entries.add('ad'.repeat(32));
      }
      return work();
    },
    async deviceBinding() {
      assert.equal(this, authoriser);
      const bound = await originalBinding.call(fake.authoriser);
      if (!recording || !bindingFault) return bound;
      return {
        credentialId: bindingFault === 'credential' ? Uint8Array.of(255) : bound.credentialId,
        policy: {
          rp_id_hash: bindingFault === 'rp' ? new Uint8Array(32) : bound.policy.rp_id_hash,
          origin: bindingFault === 'origin' ? new Uint8Array(21) : bound.policy.origin,
        },
      };
    },
    async authorise(request) {
      if (locked) throw new PassportConnectorError('NotAuthorised', 'Owner is locked.');
      if (recording) {
        trace.push(`sign:${request.circuit}`);
        signed.push(request);
      }
      return fake.authoriser.authorise(request);
    },
  };
  /** @type {import('../packages/account/dist/ports/index.js').AccountViewingKey} */
  const viewingKey = {
    ...baseKeyring,
    async createKeys(network, request) {
      if (recording) trace.push('prepare-rotation');
      return baseKeyring.createKeys(network, request);
    },
    async sealToDevice(network, ring, reader) {
      if (recording) {
        trace.push('seal-joiner');
        deliveries.push(reader);
        deliveryKeys.push(hex(ring.encKey));
      }
      return baseKeyring.sealToDevice(network, ring, reader);
    },
  };
  const controller = new AbortController();
  const flowOptions = {
    signal: controller.signal,
    onEvent: (/** @type {import('../packages/protocol/dist/index.js').PassportEvent} */ event) =>
      events.push(event),
  };
  /** @type {import('../packages/account/dist/ports/index.js').PassportPorts} */
  const ports = {
    ...fake,
    authoriser,
    viewingKey,
    holdings: { selectHeldEntries: async () => [] },
    readGrants: {
      readActiveReadGrantTargets: async () => ({
        authNonce: ledger().authNonce,
        targets: readGrant
          ? [
              {
                grantId: 'aa'.repeat(32),
                readPublicKey: hex(x25519.getPublicKey(new Uint8Array(32).fill(8))),
              },
            ]
          : [],
      }),
    },
    chain: {
      ...fake.chain,
      async readAccount(
        /** @type {string} */ address,
        /** @type {{includeInbox?: boolean; includeDevices?: boolean}} */ options = {},
      ) {
        const view = await fake.chain.readAccount(address, options);
        if (view && missingRoster) Reflect.set(view, 'deviceEntries', null);
        if (!submitted || !view) return view;
        settlementReads++;
        if (settlementReads !== 1 || !settlementFault) return view;
        if (settlementFault === 'target-only') {
          const last = signed.at(-1);
          assert.ok(last);
          return { ...view, authNonce: last.authNonce };
        }
        assert.ok(view.deviceEntries);
        return {
          ...view,
          deviceEntries: view.deviceEntries.filter((value) => hex(value) !== targetHex),
        };
      },
      async call(
        /** @type {import('../packages/account/dist/ports/index.js').CallRequest} */ request,
      ) {
        if (recording) {
          trace.push(`call:${request.circuit}`);
          calls.push(request);
          assert.equal(request.signal, flowOptions.signal);
          if (request.circuit === 'append_inbox_with_p256') appendCount++;
        }
        const result = await fake.chain.call(request);
        if (recording) {
          receipts.push(result);
          if (request.circuit === 'add_device_with_p256') {
            submitted = true;
            assert.ok(request.args[0] instanceof Uint8Array);
            targetHex = hex(request.args[0]);
          }
          if (request.circuit === 'append_inbox_with_p256' && appendCount === 2 && deliveryTamper) {
            if (deliveryTamper === 'key') ledger().encKey = new Uint8Array(32).fill(4);
            else if (deliveryTamper === 'epoch') ledger().deviceEpoch++;
            else ledger().entries.add('ad'.repeat(32));
          }
          if (
            (unknownAt === 'envelope' && appendCount === 1) ||
            (unknownAt === 'registration' && appendCount === 2) ||
            (unknownAt === 'enrollment' && request.circuit === 'add_device_with_p256')
          )
            throw unknown;
          if (lockAfterSubmit && request.circuit === 'add_device_with_p256') locked = true;
        }
        return result;
      },
    },
  };
  const account = await createPassportAccounts(ports).createAccount({
    userName: 'owner',
    retireAuthority: true,
  });
  ledger().specVersion = 3;
  /** @type {import('../packages/protocol/dist/index.js').PassportDeviceReader} */
  let reader;
  if (scheme === 'p256') {
    const joining = fakeAuthoriser({ device: 1 });
    reader = {
      scheme: 'p256-webauthn',
      readerPublicKey: hex(await keyring(7).readerPublicKey('undeployed')),
      devicePublicKey: await joining.devicePublicKeyHex(),
      policy: {
        rp_id_hash: Buffer.from(FAKE_POLICY.rp_id_hash),
        origin: Buffer.from(FAKE_POLICY.origin),
      },
    };
  } else {
    const joining = recipeJubjubAuthoriser(
      {
        withSession: (work) => work(),
        deviceSecret: async () => new Uint8Array(32).fill(11),
        deriveSecret: async () => new Uint8Array(32).fill(7),
      },
      pureCircuits,
    );
    reader = {
      readerPublicKey: hex(await keyring(7).readerPublicKey('undeployed')),
      devicePublicKey: await joining.devicePublicKeyHex(),
    };
  }
  recording = true;
  assert.ok(account.addDevice);
  const enroll = account.addDevice.bind(account);
  return {
    reader,
    enroll,
    authoriser,
    trace,
    calls,
    signed,
    scopes,
    deliveries,
    deliveryKeys,
    events,
    receipts,
    flowOptions,
    controller,
    ledger,
    unknown,
    wrongBinding(/** @type {NonNullable<typeof bindingFault>} */ fault) {
      bindingFault = fault;
    },
    tamperDelivery(/** @type {NonNullable<typeof deliveryTamper>} */ fault) {
      deliveryTamper = fault;
    },
    tamperBeforeRotation(/** @type {NonNullable<typeof beforeRotationTamper>} */ fault) {
      beforeRotationTamper = fault;
    },
    omitRoster() {
      missingRoster = true;
    },
    unknownAfter(/** @type {NonNullable<typeof unknownAt>} */ point) {
      unknownAt = point;
    },
    lockAfterSubmit() {
      lockAfterSubmit = true;
    },
    delaySettlement(/** @type {NonNullable<typeof settlementFault>} */ fault) {
      settlementFault = fault;
    },
    settlementReads: () => settlementReads,
  };
}

for (const scheme of /** @type {const} */ (['p256', 'jubjub'])) {
  for (const readGrant of [false, true]) {
    test(`public P-256 enrollment preserves ${scheme} delivery, owner scope and ${readGrant ? 'nested rotation' : 'outer'} Flow`, async () => {
      const f = await fixture({ scheme, readGrant });
      const oldKey = hex(f.ledger().encKey);
      const result = await f.enroll(f.reader, f.flowOptions);
      const appendCalls = f.calls.filter((call) => call.circuit === 'append_inbox_with_p256');
      const delivered = appendCalls.slice(-2);
      assert.equal(delivered.length, 2);
      const envelope = delivered[0]?.args[0],
        registration = delivered[1]?.args[0];
      assert.ok(envelope instanceof Uint8Array && registration instanceof Uint8Array);
      assert.equal(envelope[0], 0xd1);
      assert.equal(registration[0], scheme === 'p256' ? 0xd5 : 0xd2);
      const final = f.calls.at(-1);
      assert.equal(final?.circuit, 'add_device_with_p256');
      assert.equal(final?.onEvent, delivered[0]?.onEvent);
      assert.equal(final?.onEvent, delivered[1]?.onEvent);
      assert.equal(f.scopes.length, 1);
      assert.equal(f.scopes[0]?.kind, 'add-device');
      assert.deepEqual(
        f.scopes[0]?.reader,
        'policy' in f.reader
          ? {
              ...f.reader,
              policy: {
                rp_id_hash: Uint8Array.from(f.reader.policy.rp_id_hash),
                origin: Uint8Array.from(f.reader.policy.origin),
              },
            }
          : f.reader,
      );
      assert.equal(f.scopes[0]?.commitmentHex, result.commitmentHex);
      assert.equal(result.txHash, f.receipts.at(-1)?.txHash);
      assert.equal(f.ledger().entries.has(result.commitmentHex), true);
      assert.equal(f.deliveries[0]?.epoch, f.ledger().deviceEpoch);
      assert.equal(f.deliveries[0]?.counter, 0n);
      const signed = f.signed.at(-1);
      assert.ok(signed);
      assert.equal(result.nextUseCounter, signed.useCounter + 1n);
      assert.ok(signed.challenge instanceof Uint8Array);
      const own = await f.authoriser.devicePublicKey();
      assert.deepEqual(
        signed.challenge,
        pureCircuits.challenge_add_device_with_p256(
          { bytes: Buffer.from(signed.account, 'hex') },
          { ...own, identity: false },
          Buffer.from(result.commitmentHex, 'hex'),
          signed.authNonce,
        ),
      );
      if (readGrant) {
        const rotation = f.calls.find((call) => call.circuit === 'rotate_enc_key_with_p256');
        assert.ok(rotation);
        assert.notEqual(
          rotation.onEvent,
          final?.onEvent,
          'existing nested rotation keeps its own Flow',
        );
        assert.equal(new Set(f.events.map((event) => event.flowId)).size, 2);
        assert.ok(
          f.trace.indexOf('call:rotate_enc_key_with_p256') < f.trace.indexOf('seal-joiner'),
        );
        assert.notEqual(f.deliveryKeys[0], oldKey);
        assert.ok(result.rotationTxHash);
        assert.deepEqual(
          result.sealedReadGrants?.map(({ grantId }) => grantId),
          ['aa'.repeat(32)],
        );
      } else {
        assert.equal(new Set(f.events.map((event) => event.flowId)).size, 1);
        assert.equal(f.deliveryKeys[0], oldKey);
        assert.equal(result.rotationTxHash, undefined);
      }
    });
  }
}

test('joining policy Buffers and public fields are admitted before the first binding await', async () => {
  const f = await fixture();
  assert.ok('policy' in f.reader);
  const original = {
    ...f.reader,
    policy: {
      rp_id_hash: Uint8Array.from(f.reader.policy.rp_id_hash),
      origin: Uint8Array.from(f.reader.policy.origin),
    },
  };
  const pending = f.enroll(f.reader, f.flowOptions);
  f.reader.policy.rp_id_hash.fill(0);
  f.reader.policy.origin.fill(0);
  Object.assign(f.reader, { readerPublicKey: 'ff'.repeat(32), devicePublicKey: 'ee'.repeat(33) });
  await pending;
  const delivered = f.deliveries[0];
  assert.ok(delivered?.scheme === 'p256-webauthn' && delivered.policy);
  assert.equal(delivered.readerPublicKey, original.readerPublicKey);
  assert.equal(delivered.devicePublicKey, original.devicePublicKey);
  assert.deepEqual(delivered.policy.rp_id_hash, original.policy.rp_id_hash);
  assert.deepEqual(delivered.policy.origin, original.policy.origin);
  assert.deepEqual(f.scopes[0]?.reader, original);
});

for (const fault of /** @type {const} */ (['credential', 'rp', 'origin'])) {
  test(`selected owner ${fault} mismatch refuses enrollment before key delivery or rotation`, async () => {
    const f = await fixture({ readGrant: true });
    const key = hex(f.ledger().encKey),
      nonce = f.ledger().authNonce;
    f.wrongBinding(fault);
    await assert.rejects(f.enroll(f.reader, f.flowOptions), {
      code: 'NotAuthorised',
      message: 'The selected passkey does not own this ACC.',
    });
    assert.equal(f.calls.length, 0);
    assert.equal(f.deliveries.length, 0);
    assert.equal(hex(f.ledger().encKey), key);
    assert.equal(f.ledger().authNonce, nonce);
  });
}

for (const fault of /** @type {const} */ (['key', 'epoch', 'roster'])) {
  test(`concurrent ${fault} change before grant-aware rotation prevents fresh keys and delivery`, async () => {
    const f = await fixture({ readGrant: true });
    f.tamperBeforeRotation(fault);
    await assert.rejects(f.enroll(f.reader, f.flowOptions), {
      code: 'GrantRosterUnsettled',
      message: 'The ACC or read-grant roster changed before enrollment rotation.',
    });
    assert.equal(f.calls.length, 0);
    assert.equal(f.trace.includes('prepare-rotation'), false);
    assert.equal(f.deliveries.length, 0);
  });
  test(`concurrent ${fault} change after publication prevents final enrollment`, async () => {
    const f = await fixture();
    f.tamperDelivery(fault);
    await assert.rejects(f.enroll(f.reader, f.flowOptions), {
      code: fault === 'roster' ? 'DeviceRosterInvalid' : 'EncryptionKeyMismatch',
    });
    assert.equal(f.calls.length, 2);
    assert.ok(f.calls.every((call) => call.circuit === 'append_inbox_with_p256'));
  });
}

for (const point of /** @type {const} */ (['envelope', 'registration', 'enrollment'])) {
  test(`unknown ${point} publication retains its original failure without repeated or later dispatch`, async () => {
    const f = await fixture();
    f.unknownAfter(point);
    await assert.rejects(f.enroll(f.reader, f.flowOptions), (error) => error === f.unknown);
    assert.equal(f.calls.length, { envelope: 1, registration: 2, enrollment: 3 }[point]);
    if (point !== 'enrollment')
      assert.equal(
        f.calls.some((call) => call.circuit === 'add_device_with_p256'),
        false,
      );
    assert.ok(
      f.receipts.at(-1)?.txHash,
      'the synthetic transport retains the original dispatched receipt',
    );
  });
}

test('public enrollment forwards a replaced owner session and binding guard with their original receiver', async () => {
  const f = await fixture();
  let sessions = 0,
    bindings = 0;
  const binding = f.authoriser.deviceBinding;
  assert.ok(binding);
  f.authoriser.withKeySession = async function (work, descriptor) {
    assert.equal(this, f.authoriser);
    assert.equal(descriptor?.kind, 'add-device');
    sessions++;
    return work();
  };
  f.authoriser.deviceBinding = async function () {
    assert.equal(this, f.authoriser);
    bindings++;
    return binding.call(this);
  };
  await f.enroll(f.reader, f.flowOptions);
  assert.equal(sessions, 1);
  assert.equal(bindings, 1);
});

test('a chain response without live device data retains the enrollment boundary error', async () => {
  const f = await fixture();
  f.omitRoster();
  await assert.rejects(f.enroll(f.reader, f.flowOptions), {
    code: 'BindingUnsupported',
    message: 'The chain port omits ACC roster or inbox data.',
  });
  assert.equal(f.scopes.length, 0);
  assert.equal(f.calls.length, 0);
});

test('abort at the final signature checkpoint prevents a final add-device dispatch', async () => {
  const f = await fixture();
  const sign = f.authoriser.authorise;
  f.authoriser.authorise = async function (request) {
    const result = await sign.call(this, request);
    if (request.circuit === 'add_device_with_p256') f.controller.abort();
    return result;
  };
  await assert.rejects(f.enroll(f.reader, f.flowOptions), { code: 'Aborted' });
  assert.equal(f.calls.length, 2);
  assert.equal(
    f.calls.some((call) => call.circuit === 'add_device_with_p256'),
    false,
  );
});

test('a confirmed enrollment receipt survives local owner lock after final submission', async () => {
  const f = await fixture();
  f.lockAfterSubmit();
  const result = await f.enroll(f.reader, f.flowOptions);
  assert.equal(result.txHash, f.receipts.at(-1)?.txHash);
  assert.equal(f.ledger().entries.has(result.commitmentHex), true);
  assert.equal(f.calls.length, 3);
});

for (const first of /** @type {const} */ (['nonce-only', 'target-only'])) {
  test(`enrollment waits when its first settlement observation has ${first}`, async () => {
    const f = await fixture();
    f.delaySettlement(first);
    const result = await f.enroll(f.reader, f.flowOptions);
    assert.equal(
      f.settlementReads(),
      2,
      'both nonce advancement and target membership are required',
    );
    assert.equal(f.calls.length, 3, 'settlement polling never repeats the submitted mutation');
    assert.equal(result.txHash, f.receipts.at(-1)?.txHash);
  });
}
