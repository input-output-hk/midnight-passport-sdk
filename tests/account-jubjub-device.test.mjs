import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addJubjubAuthorisingDevice } from '../packages/account/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

const owner = { x: 1n, y: 2n };
const joining = { x: 5n, y: 6n };
const account = 'ab'.repeat(32);
const record = {
  address: account,
  bindingId: 'acc-s3r1.1',
  scheme: /** @type {const} */ ('jubjub-schnorr'),
  credentialId: Uint8Array.of(10),
  localUseCounter: 0n,
};
const hint = {
  address: account,
  scheme: /** @type {const} */ ('jubjub-schnorr'),
  publicKey: owner,
  credentialId: Uint8Array.of(10),
  status: /** @type {const} */ ('active'),
};
/** @type {import('../packages/account/dist/jubjub-device.js').AddJubjubAuthorisingDeviceInput} */
const input = { hint, joiningPublicKey: joining };

function fixture() {
  /** @type {string[]} */
  const calls = [];
  /** @type {import('../packages/account/dist/ports/index.js').AccountRecord[]} */
  const writes = [];
  /** @type {import('../packages/account/dist/jubjub-device.js').AddJubjubAuthorisingDevicePorts} */
  const ports = {
    bindingId: 'acc-s3r1.1',
    random: (length) => new Uint8Array(length),
    pure: {
      derive_device_entry_with_jubjub: (_account, pk, _epoch, counter) =>
        new Uint8Array(32).fill(Number(pk.x + counter)),
      challenge_add_device_with_jubjub: (_account, _sigR, pk, entry, nonce) => {
        calls.push('challenge');
        assert.deepEqual(pk, owner);
        assert.equal(entry[0], 5);
        assert.equal(nonce, 7n);
        return new Uint8Array(32);
      },
    },
    chain: {
      readAccount: async (_account, options) => {
        assert.equal(options?.includeDevices, true);
        return {
          booted: true,
          authNonce: 7n,
          deviceEpoch: 0n,
          entryCount: 1,
          specVersion: 3,
          hasEntry: (entry) => entry[0] === 3,
        };
      },
      call: async (request) => {
        calls.push('call');
        assert.equal(request.circuit, 'add_device_with_jubjub');
        assert.deepEqual(request.args, [new Uint8Array(32).fill(5), owner, 2n, owner, 9n, 10n]);
        return { txHash: 'tx' };
      },
    },
    authoriser: {
      scheme: 'jubjub-schnorr',
      devicePublicKey: async () => owner,
      authorise: async (request) => {
        calls.push('sign');
        assert.equal(request.useCounter, 2n);
        if (typeof request.challenge !== 'function') throw new Error('missing challenge builder');
        request.challenge(owner, 10n);
        return {
          scheme: 'jubjub-schnorr',
          pk: owner,
          useCounter: request.useCounter,
          sigR: owner,
          sigS: 9n,
          grindNonce: 10n,
        };
      },
      withKeySession: async (operation, flow) => {
        calls.push('session');
        assert.deepEqual(flow, { kind: 'add-device', commitmentHex: '05'.repeat(32) });
        return operation();
      },
    },
    records: {
      read: async () => record,
      write: async (next) => {
        calls.push('write');
        writes.push(next);
      },
      exists: async () => true,
    },
  };
  return { ports, calls, writes };
}

test('authorising-only JubJub enrollment pins the challenge and persists the advanced counter', async () => {
  const { ports, calls, writes } = fixture();
  const result = await addJubjubAuthorisingDevice(input, ports);
  assert.deepEqual(result, {
    txHash: 'tx',
    commitmentHex: '05'.repeat(32),
    nextUseCounter: 3n,
  });
  assert.deepEqual(calls, ['session', 'sign', 'challenge', 'call', 'write']);
  assert.deepEqual(writes, [{ ...record, localUseCounter: 3n }]);
});

test('self-enrollment and a mismatched account are rejected before any key session', async () => {
  const { ports, calls } = fixture();
  await assert.rejects(addJubjubAuthorisingDevice({ ...input, joiningPublicKey: owner }, ports), {
    code: 'NotAuthorised',
  });
  await assert.rejects(
    addJubjubAuthorisingDevice(
      { ...input, hint: { ...hint, credentialId: Uint8Array.of(11) } },
      ports,
    ),
    { code: 'NotAuthorised' },
  );
  await assert.rejects(
    addJubjubAuthorisingDevice(input, {
      ...ports,
      records: { ...ports.records, read: async () => ({ ...record, bindingId: 'other' }) },
    }),
    { code: 'NotAuthorised' },
  );
  assert.deepEqual(calls, []);
});

test('a failed chain call does not advance the stored use counter', async () => {
  const { ports, writes } = fixture();
  /** @type {import('../packages/account/dist/jubjub-device.js').AddJubjubAuthorisingDevicePorts} */
  const failing = {
    ...ports,
    chain: {
      ...ports.chain,
      call: async () => {
        throw new Error('chain refused');
      },
    },
  };
  await assert.rejects(addJubjubAuthorisingDevice(input, failing), { code: 'InternalError' });
  assert.deepEqual(writes, []);
});

test('a key session for another owner cannot authorise enrollment', async () => {
  const { ports, calls, writes } = fixture();
  const wrongOwner = {
    ...ports,
    authoriser: { ...ports.authoriser, devicePublicKey: async () => joining },
  };
  await assert.rejects(addJubjubAuthorisingDevice(input, wrongOwner), {
    code: 'NotAuthorised',
  });
  assert.deepEqual(calls, ['session']);
  assert.deepEqual(writes, []);
});

test('the packaged ACC pure helpers derive and challenge an actual JubJub enrollment', async () => {
  const ownerKey = pureCircuits.compute_public_point_with_jubjub(1n);
  const joiningKey = pureCircuits.compute_public_point_with_jubjub(2n);
  const self = { bytes: Uint8Array.from({ length: 32 }, () => 0xab) };
  const ownEntry = pureCircuits.derive_device_entry_with_jubjub(self, ownerKey, 0n, 2n);
  const joiningEntry = pureCircuits.derive_device_entry_with_jubjub(self, joiningKey, 0n, 0n);
  let challenged = false;
  const result = await addJubjubAuthorisingDevice(
    {
      hint: { ...hint, publicKey: ownerKey },
      joiningPublicKey: joiningKey,
    },
    {
      bindingId: 'acc-s3r1.1',
      pure: pureCircuits,
      random: (length) => new Uint8Array(length),
      chain: {
        readAccount: async () => ({
          booted: true,
          authNonce: 7n,
          deviceEpoch: 0n,
          entryCount: 1,
          specVersion: 3,
          hasEntry: (entry) => Buffer.from(entry).equals(Buffer.from(ownEntry)),
        }),
        call: async (request) => {
          assert.deepEqual(request.args[0], joiningEntry);
          return { txHash: 'binding-test' };
        },
      },
      authoriser: {
        scheme: 'jubjub-schnorr',
        devicePublicKey: async () => ownerKey,
        withKeySession: (operation) => operation(),
        authorise: async (request) => {
          if (typeof request.challenge !== 'function') throw new Error('missing challenge');
          const challenge = request.challenge(ownerKey, 0n);
          assert.equal(challenge.length, 32);
          challenged = true;
          return {
            scheme: 'jubjub-schnorr',
            pk: ownerKey,
            useCounter: request.useCounter,
            sigR: ownerKey,
            sigS: 0n,
            grindNonce: 0n,
          };
        },
      },
      records: {
        read: async () => record,
        write: async () => undefined,
        exists: async () => true,
      },
    },
  );
  assert.equal(challenged, true);
  assert.equal(result.commitmentHex, Buffer.from(joiningEntry).toString('hex'));
});
