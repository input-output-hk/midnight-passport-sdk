import assert from 'node:assert/strict';
import { test } from 'node:test';
import { proveUnboundNightDeposit } from '../packages/adapter-midnight-js/dist/index.js';
import * as binding from '../packages/contract/generated/acc-s3r1.1/index.js';

const baseline = () => ({
  network: {
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    manifestSha256: 'ab'.repeat(32),
    indexerUrl: 'http://127.0.0.1:18108/api/v4/graphql',
    indexerWsUrl: 'ws://127.0.0.1:18108/api/v4/graphql/ws',
    nodeUrl: 'http://127.0.0.1:19964',
    artefactUrl: 'http://127.0.0.1:18798/v1/zk/acc-s3r1.1',
  },
  binding,
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
});
