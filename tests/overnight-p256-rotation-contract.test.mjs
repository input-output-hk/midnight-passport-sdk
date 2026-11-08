// Trace contracts exercise generated challenges, actual key recipes and software ES256.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pureCircuits as pure } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { fixture, grantId } from './fixtures/overnight-p256-rotation-fixture.mjs';

test('public rotation publishes in order, rescans the owner, observes the key, then appends holdings', async () => {
  const f = await fixture();
  assert.ok(f.account.rotateViewingKey);
  const before = f.ledger().encKey;
  const result = await f.account.rotateViewingKey(f.options);
  const material = f.materials[0];
  assert.ok(material);
  const switchIndex = f.calls.findIndex((call) => call.circuit === 'rotate_enc_key_with_p256');
  assert.ok(switchIndex > 0);
  const published = f.calls.slice(0, switchIndex).map((call) => call.args[0]);
  assert.deepEqual(published.slice(0, material.envelopes.length), material.envelopes);
  assert.deepEqual(
    published.slice(
      material.envelopes.length,
      material.envelopes.length + material.registrations.length,
    ),
    material.registrations,
  );
  assert.equal(published.length, material.envelopes.length + material.registrations.length + 1);
  const publication = f.trace.filter(
    (item) => item.startsWith('call:') || item.startsWith('read:devices:'),
  );
  for (let i = 0; i < publication.length; i++)
    if (publication[i] === 'call:append_inbox_with_p256')
      assert.equal(publication[i + 1], 'read:devices:old');
  assert.ok(
    f.trace.indexOf('read:inbox:new') < f.trace.indexOf('call:append_inbox_with_p256:holding'),
  );
  const signed = f.signed.find((request) => request.circuit === 'rotate_enc_key_with_p256');
  assert.ok(signed);
  const call = f.calls[switchIndex];
  assert.ok(call);
  assert.deepEqual(
    signed.challenge,
    pure.challenge_rotate_enc_key_with_p256(
      { bytes: Buffer.from(call.address, 'hex') },
      { ...(await f.authoriser.devicePublicKey()), identity: false },
      material.encKey,
      signed.authNonce,
    ),
  );
  const proof = call.args[1];
  assert.ok(proof && typeof proof === 'object' && 'use_counter' in proof);
  assert.equal(proof.use_counter, signed.useCounter);
  const firstSignature = f.signed[0];
  assert.ok(firstSignature);
  assert.equal(signed.useCounter, firstSignature.useCounter + BigInt(published.length));
  assert.equal(call.args[0], material.encKey);
  assert.notDeepEqual(f.ledger().encKey, before);
  assert.equal(f.keyRequests[0]?.rotateRoster, undefined);
  assert.deepEqual(
    result.sealedReadGrants.map((item) => item.grantId),
    [grantId],
  );
  assert.equal(result.txHash, f.receipts[switchIndex]?.txHash);
  assert.equal(f.sessions.length, 1);
  assert.equal(new Set(f.calls.map((item) => item.onEvent)).size, 1);
  assert.ok(f.calls.every((item) => item.signal === f.options.signal));
});

test('removal delivers holdings before callback and fresh authority mutation, retaining both receipts', async () => {
  const f = await fixture();
  const result = await f.internal(f.target, undefined, (state) => {
    f.trace.push('callback');
    assert.equal(state.encKey, f.materials[0]?.encKey);
    assert.equal(state.authNonce, f.ledger().authNonce);
  });
  assert.ok('rotationTxHash' in result);
  assert.equal(f.keyRequests[0]?.rotateRoster, true);
  assert.ok(f.trace.indexOf('call:append_inbox_with_p256:holding') < f.trace.indexOf('callback'));
  assert.ok(f.trace.indexOf('callback') < f.trace.indexOf('sign:remove_device_with_p256'));
  const rotation = f.calls.findIndex((call) => call.circuit === 'rotate_enc_key_with_p256');
  assert.equal(result.rotationTxHash, f.receipts[rotation]?.txHash);
  assert.equal(result.txHash, f.receipts.at(-1)?.txHash);
  const removal = f.signed.at(-1);
  assert.ok(removal);
  assert.deepEqual(
    removal.challenge,
    pure.challenge_remove_device_with_p256(
      { bytes: Buffer.from(removal.account, 'hex') },
      { ...(await f.authoriser.devicePublicKey()), identity: false },
      Buffer.from(f.target, 'hex'),
      removal.authNonce,
    ),
  );
  assert.deepEqual(f.sessions, [
    { kind: 'remove-device', account: f.account.address, commitmentHex: f.target },
  ]);
});

for (const state of [
  'key',
  'epoch',
  'nonce',
  'roster',
  'drop-inbox',
  'extra-inbox',
  'grant-id',
  'grant-key',
  'grant-nonce',
]) {
  test(`concurrent ${state} mutation after publication refuses before switching`, async () => {
    const f = await fixture();
    f.fault.state = state;
    await assert.rejects(f.internal(undefined, undefined, undefined));
    assert.ok(f.calls.every((call) => call.circuit === 'append_inbox_with_p256'));
  });
}

for (const boundary of ['first', 'late', 'switch', 'holding', 'remove', 'callback']) {
  test(`uncertain ${boundary} effect retains the original error and never dispatches a later phase`, async () => {
    const f = await fixture();
    f.fault.boundary = boundary;
    await assert.rejects(
      f.internal(f.target, undefined, () => {
        if (boundary === 'callback') throw f.unknown;
      }),
      (error) => error === f.unknown,
    );
    const last = f.calls.at(-1)?.circuit;
    if (
      boundary === 'first' ||
      boundary === 'late' ||
      boundary === 'holding' ||
      boundary === 'callback'
    )
      assert.equal(last, 'append_inbox_with_p256');
    if (boundary === 'switch') assert.equal(last, 'rotate_enc_key_with_p256');
    if (boundary === 'remove') assert.equal(last, 'remove_device_with_p256');
    assert.equal(
      f.calls.filter((call) => call.circuit === 'rotate_enc_key_with_p256').length,
      ['first', 'late'].includes(boundary) ? 0 : 1,
    );
    assert.equal(
      f.calls.filter((call) => call.circuit === 'remove_device_with_p256').length,
      boundary === 'remove' ? 1 : 0,
    );
  });
}

for (const signature of ['counter', 'key', 'scheme']) {
  test(`returned ${signature} mismatch refuses the key switch`, async () => {
    const f = await fixture();
    f.fault.signature = signature;
    await assert.rejects(f.internal(undefined, undefined, undefined), {
      code: 'NotAuthorised',
      message: 'The signature names another device.',
    });
    assert.ok(f.calls.every((call) => call.circuit === 'append_inbox_with_p256'));
  });
}

test('exclusions omit seals while the complete grant snapshot remains a live fence', async () => {
  for (const exclusion of [grantId, 'all']) {
    const f = await fixture();
    const result = await f.internal(undefined, exclusion, undefined);
    assert.deepEqual(result.sealedReadGrants, []);
    const changed = await fixture();
    changed.fault.state = 'grant-id';
    await assert.rejects(changed.internal(undefined, exclusion, undefined), {
      code: 'GrantRosterUnsettled',
      message: 'The read-grant roster changed.',
    });
  }
  const absent = await fixture();
  absent.setTargets([]);
  await assert.rejects(absent.internal(undefined, grantId, undefined), {
    code: 'GrantRosterUnsettled',
    message: 'The read grant disappeared before key rotation.',
  });
});

test('public rotation forwards host wrappers replaced after opening with the authoriser receiver', async () => {
  const f = await fixture();
  const withSession = f.authoriser.withKeySession,
    binding = f.authoriser.deviceBinding,
    publicKey = f.authoriser.devicePublicKeyHex;
  assert.ok(withSession && binding && publicKey);
  const used = new Set();
  f.authoriser.withKeySession = async function (work, descriptor) {
    assert.equal(this, f.authoriser);
    used.add('session');
    return withSession.bind(this)(work, descriptor);
  };
  f.authoriser.deviceBinding = async function () {
    assert.equal(this, f.authoriser);
    used.add('binding');
    return binding.call(this);
  };
  f.authoriser.devicePublicKeyHex = async function () {
    assert.equal(this, f.authoriser);
    used.add('key');
    return publicKey.call(this);
  };
  assert.ok(f.account.rotateViewingKey);
  await f.account.rotateViewingKey(f.options);
  assert.deepEqual([...used].sort(), ['binding', 'key', 'session']);
});

for (const settle of ['nonce-only', 'target-only']) {
  test(`removal waits through a first ${settle} observation`, async () => {
    const f = await fixture();
    f.fault.settle = settle;
    await f.internal(f.target, undefined, undefined);
    assert.equal(f.readsAfterRemove(), 2);
    assert.ok(f.trace.includes('sleep'));
  });
}

test('signature cancellation prevents key dispatch; an already dispatched acknowledgement survives later local lock', async () => {
  const cancelled = await fixture();
  cancelled.fault.abort = true;
  await assert.rejects(cancelled.internal(undefined, undefined, undefined), { code: 'Aborted' });
  assert.ok(cancelled.calls.every((call) => call.circuit === 'append_inbox_with_p256'));
  const late = await fixture();
  late.fault.lock = true;
  late.fault.noHoldings = true;
  const result = await late.internal(undefined, undefined, undefined);
  assert.equal(result.txHash, late.receipts.at(-1)?.txHash);
  assert.equal(late.fault.locked, true);
});

test('the final grant roster reads the current host source after its start observer', async () => {
  const f = await fixture();
  const original = f.ports.readGrants;
  assert.ok(original);
  let replacementReads = 0;
  Object.assign(f.options, {
    onEvent(/** @type {import('../packages/protocol/dist/index.js').PassportEvent} */ event) {
      if (event.step !== 'grant.roster' || event.phase !== 'start' || !f.calls.length) return;
      Object.assign(f.ports, {
        readGrants: {
          async readActiveReadGrantTargets(/** @type {string} */ account) {
            replacementReads++;
            return original.readActiveReadGrantTargets(account);
          },
        },
      });
    },
  });
  assert.ok(f.account.rotateViewingKey);
  await f.account.rotateViewingKey(f.options);
  assert.equal(replacementReads, 1);
});
