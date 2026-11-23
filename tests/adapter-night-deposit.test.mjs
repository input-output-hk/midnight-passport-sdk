import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertPinnedNightRecipientRoster,
  assertNightDepositPreflight,
  proveUnboundNightDeposit,
} from '../packages/adapter-midnight-js/dist/index.js';
import * as binding from '../packages/contract/generated/acc-s3r1.1/index.js';
import { pinnedVerifierRoster, resolvePinnedBinding } from '../packages/contract/dist/index.js';

const baseline = () => ({
  network: {
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    manifestSha256: resolvePinnedBinding('acc-s3r1.1').manifestSha256,
    indexerUrl: 'http://127.0.0.1:18108/api/v4/graphql',
    indexerWsUrl: 'ws://127.0.0.1:18108/api/v4/graphql/ws',
    nodeUrl: 'http://127.0.0.1:19964',
    artefactUrl: 'http://127.0.0.1:18798/v1/zk/acc-s3r1.1',
  },
  binding,
  recipientVerifierRoster: pinnedVerifierRoster('acc-s3r1.1'),
  target: 'cd'.repeat(32),
  amount: 4n,
  walletKeys: { coinPublicKey: 'coin', encryptionPublicKey: 'encryption' },
  prover: {
    async proveTx() {
      throw new Error('An invalid request must not reach the prover.');
    },
  },
});

test('unbound NIGHT deposit refuses unsupported network, binding, target, amount and manifest before I/O', async () => {
  assert.doesNotThrow(() => assertNightDepositPreflight(baseline()));
  const invalid = [
    { network: { ...baseline().network, networkId: 'preview' } },
    { network: { ...baseline().network, bindingId: 'other' } },
    { network: { ...baseline().network, manifestSha256: 'unverified' } },
    { target: 'not-a-contract' },
    { amount: 0n },
    { amount: 1n << 128n },
    { walletKeys: { coinPublicKey: '', encryptionPublicKey: '' } },
  ];
  for (const change of invalid)
    await assert.rejects(
      () => proveUnboundNightDeposit({ ...baseline(), ...change }),
      /Unsupported pinned NIGHT deposit request/,
    );
  for (const change of [
    { amount: 4 },
    { walletKeys: { coinPublicKey: 1, encryptionPublicKey: 2 } },
  ])
    assert.throws(
      () =>
        assertNightDepositPreflight(
          /** @type {Parameters<typeof assertNightDepositPreflight>[0]} */ (
            /** @type {unknown} */ ({ ...baseline(), ...change })
          ),
        ),
      /Unsupported pinned NIGHT deposit request/,
    );
  for (const change of [
    { binding: { ...binding, Contract: undefined } },
    { prover: { proveTx: undefined } },
  ])
    assert.throws(
      () =>
        assertNightDepositPreflight(
          /** @type {Parameters<typeof assertNightDepositPreflight>[0]} */ (
            /** @type {unknown} */ ({ ...baseline(), ...change })
          ),
        ),
      /Unsupported pinned NIGHT deposit request/,
    );
});

test('provisional NIGHT deposit needs the exact pin, explicit opt-in and loopback API v4', () => {
  const candidate = {
    ...baseline(),
    network: {
      ...baseline().network,
      bindingId: 'acc-s3r1.1-zkir036',
      manifestSha256: resolvePinnedBinding('acc-s3r1.1-zkir036').manifestSha256,
      indexerUrl: 'http://127.0.0.1:8088/api/v4/graphql',
      indexerWsUrl: 'ws://127.0.0.1:8088/api/v4/graphql/ws',
      nodeUrl: 'http://127.0.0.1:9944',
      artefactUrl: 'http://127.0.0.1:8787/v1/zk/acc-s3r1.1-zkir036',
    },
    provisionalLocal: true,
    recipientVerifierRoster: pinnedVerifierRoster('acc-s3r1.1-zkir036'),
  };
  assert.doesNotThrow(() => assertNightDepositPreflight(candidate));
  for (const changed of [
    { provisionalLocal: false },
    { network: { ...candidate.network, manifestSha256: 'ab'.repeat(32) } },
    { network: { ...candidate.network, networkId: 'preview' } },
    { network: { ...candidate.network, nodeUrl: 'https://node.example' } },
    { network: { ...candidate.network, indexerUrl: 'http://remote.example/api/v4/graphql' } },
    { network: { ...candidate.network, indexerWsUrl: 'ws://127.0.0.1:8088/api/v3/graphql/ws' } },
    { network: { ...candidate.network, artefactUrl: 'http://127.0.0.1:8787/v1/zk/acc-s3r1.1' } },
  ])
    assert.throws(
      () => assertNightDepositPreflight({ ...candidate, ...changed }),
      /Unsupported pinned NIGHT deposit request/,
    );
});

test('recipient proof guard requires the complete pinned circuit assignment', async () => {
  const entries = await Promise.all(
    Array.from({ length: 52 }, async (_, index) => {
      const name = `circuit_${index}`;
      const bytes = Uint8Array.of(index);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      return { name, bytes, hash: Buffer.from(digest).toString('hex') };
    }),
  );
  const expected = Object.fromEntries(entries.map(({ name, hash }) => [name, hash]));
  const keys = new Map(entries.map(({ name, bytes }) => [name, bytes]));
  const state = {
    operations: () => [...keys.keys()],
    /** @param {string} name */
    operation: (name) => {
      const verifierKey = keys.get(name);
      return verifierKey ? { verifierKey } : undefined;
    },
  };
  await assert.doesNotReject(() => assertPinnedNightRecipientRoster(state, expected));
  const swapped = new Map(keys);
  const replacement = keys.get('circuit_1');
  assert.ok(replacement);
  swapped.set('circuit_0', replacement);
  await assert.rejects(
    () =>
      assertPinnedNightRecipientRoster(
        {
          ...state,
          /** @param {string} name */
          operation: (name) => {
            const verifierKey = swapped.get(name);
            return verifierKey ? { verifierKey } : undefined;
          },
        },
        expected,
      ),
    /recipient ACC verifier roster differs/,
  );
  const incomplete = { ...expected };
  delete incomplete.circuit_0;
  await assert.rejects(
    () => assertPinnedNightRecipientRoster(state, incomplete),
    /recipient ACC verifier roster differs/,
  );
  await assert.rejects(
    () =>
      assertPinnedNightRecipientRoster(
        { ...state, operations: () => [...keys.keys(), 'extra'] },
        expected,
      ),
    /recipient ACC verifier roster differs/,
  );
});
