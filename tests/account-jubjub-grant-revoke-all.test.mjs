import assert from 'node:assert/strict';
import { test } from 'node:test';
import { revokeAllJubjubGrants } from '../packages/account/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

const address = 'ab'.repeat(32);
const owner = pureCircuits.compute_public_point_with_jubjub(7n);
const hint = {
  address,
  scheme: /** @type {const} */ ('jubjub-schnorr'),
  publicKey: owner,
  credentialId: Uint8Array.of(10),
  status: /** @type {const} */ ('active'),
};

function fixture() {
  /** @type {string[]} */
  const calls = [];
  let nonce = 5n;
  let counter = 0n;
  let generation = 2n;
  let settle = true;
  /** @type {{id:string,active:boolean,read:boolean}[]} */
  let entries = [
    { id: '01'.repeat(32), active: true, read: false },
    { id: '02'.repeat(32), active: false, read: true },
  ];
  /** @type {import('../packages/account/dist/ports/index.js').AccountRecord} */
  let record = {
    address,
    bindingId: 'acc-s3r1.1',
    scheme: 'jubjub-schnorr',
    credentialId: Uint8Array.of(10),
    localUseCounter: 0n,
  };
  /** @type {import('../packages/account/dist/jubjub-grant-revoke-all.js').RevokeAllJubjubGrantsPorts} */
  const ports = {
    bindingId: 'acc-s3r1.1',
    pure: pureCircuits,
    random: (length) => new Uint8Array(length).fill(2),
    attempts: 2,
    sleep: async () => {},
    records: {
      exists: async () => true,
      read: async () => record,
      write: async (next) => {
        calls.push('record');
        record = next;
      },
    },
    grants: {
      readGrantRoster: async () => {
        calls.push('roster');
        return { authNonce: nonce, generation, entries: entries.map((entry) => ({ ...entry })) };
      },
    },
    chain: {
      readAccount: async () => ({
        booted: true,
        specVersion: 3,
        authNonce: nonce,
        deviceEpoch: 0n,
        entryCount: 1,
        hasEntry: (entry) =>
          Buffer.from(entry).equals(
            Buffer.from(
              pureCircuits.derive_device_entry_with_jubjub(
                { bytes: Buffer.from(address, 'hex') },
                owner,
                0n,
                counter,
              ),
            ),
          ),
      }),
      call: async (request) => {
        calls.push('call');
        assert.equal(request.circuit, 'revoke_all_grants_with_jubjub');
        assert.equal(request.args.length, 5);
        assert.equal(request.args[1], counter);
        if (settle) {
          entries = [];
          generation++;
          nonce++;
          counter++;
        }
        return { txHash: 'clear-tx' };
      },
    },
    authoriser: {
      scheme: 'jubjub-schnorr',
      devicePublicKey: async () => owner,
      withKeySession: async (operation, flow) => {
        calls.push('session');
        assert.deepEqual(flow, {
          kind: 'revoke-all-grants',
          account: address,
          ...(entries.some(({ active, read }) => active && read) && { read: true, devices: [] }),
        });
        return operation();
      },
      authorise: async (request) => {
        calls.push('sign');
        assert.equal(request.circuit, 'revoke_all_grants_with_jubjub');
        assert.equal(request.useCounter, counter);
        if (typeof request.challenge !== 'function') throw new Error('missing challenge');
        assert.deepEqual(
          request.challenge(owner, 3n),
          pureCircuits.challenge_revoke_all_grants_with_jubjub(
            { bytes: Buffer.from(address, 'hex') },
            owner,
            owner,
            nonce,
            3n,
          ),
        );
        return {
          scheme: 'jubjub-schnorr',
          pk: owner,
          useCounter: counter,
          sigR: owner,
          sigS: 8n,
          grindNonce: 3n,
        };
      },
    },
  };
  return {
    ports,
    calls,
    record: () => record,
    setEntries: (/** @type {typeof entries} */ value) => (entries = value),
    setGeneration: (/** @type {bigint} */ value) => (generation = value),
    preventSettlement: () => (settle = false),
    advanceRotation: () => {
      calls.push('rotation');
      nonce++;
      counter++;
    },
  };
}

test('owner clears spend grants and tombstones with the pinned challenge and confirms generation', async () => {
  const { ports, calls, record } = fixture();
  const result = await revokeAllJubjubGrants({ hint }, ports);
  assert.deepEqual(result, {
    txHash: 'clear-tx',
    status: 'cleared',
    generation: 3n,
    nextUseCounter: 1n,
  });
  assert.equal(record().localUseCounter, 1n);
  assert.deepEqual(calls, ['roster', 'session', 'sign', 'roster', 'call', 'record', 'roster']);
});

test('a live read grant is refused before consent or submission', async () => {
  const { ports, calls, setEntries } = fixture();
  setEntries([{ id: '01'.repeat(32), active: true, read: true }]);
  await assert.rejects(revokeAllJubjubGrants({ hint }, ports), { code: 'BindingUnsupported' });
  assert.deepEqual(calls, ['roster']);
});

test('read revoke-all rotates before clearing and confirms the new generation', async () => {
  const { ports, calls, setEntries, advanceRotation } = fixture();
  setEntries([{ id: '01'.repeat(32), active: true, read: true }]);
  const result = await revokeAllJubjubGrants(
    { hint },
    {
      ...ports,
      rotateBeforeRevokeAll: async () => {
        advanceRotation();
        return {
          txHash: 'rotation-tx',
          droppedDeviceEntries: [],
          sealedReadGrants: [],
          unsealedGrantIds: [],
        };
      },
    },
  );
  assert.equal(result.status, 'cleared');
  assert.equal(result.rotation?.txHash, 'rotation-tx');
  assert.deepEqual(result.rotation?.sealedReadGrants, []);
  assert.ok(calls.indexOf('rotation') < calls.indexOf('call'));
  assert.equal(result.nextUseCounter, 2n);
});

test('read revoke-all refuses a grant-map change after rotation', async () => {
  const { ports, calls, setEntries, advanceRotation } = fixture();
  setEntries([{ id: '01'.repeat(32), active: true, read: true }]);
  await assert.rejects(
    revokeAllJubjubGrants(
      { hint },
      {
        ...ports,
        rotateBeforeRevokeAll: async () => {
          advanceRotation();
          setEntries([{ id: '03'.repeat(32), active: true, read: true }]);
          return {
            txHash: 'rotation-tx',
            droppedDeviceEntries: [],
            sealedReadGrants: [],
            unsealedGrantIds: [],
          };
        },
      },
    ),
    { code: 'GrantRosterUnsettled' },
  );
  assert.ok(!calls.includes('call'));
});

test('a changed grant generation before submission is refused', async () => {
  const { ports, calls, setGeneration } = fixture();
  const sign = ports.authoriser.authorise;
  ports.authoriser.authorise = async (request) => {
    const result = await sign(request);
    setGeneration(3n);
    return result;
  };
  await assert.rejects(revokeAllJubjubGrants({ hint }, ports), {
    code: 'GrantRosterUnsettled',
  });
  assert.ok(!calls.includes('call'));
});

test('an accepted call without a confirmed empty generation stays unsettled', async () => {
  const { ports, calls, preventSettlement } = fixture();
  preventSettlement();
  await assert.rejects(revokeAllJubjubGrants({ hint }, ports), {
    code: 'GrantRosterUnsettled',
  });
  assert.ok(calls.includes('call'));
});
