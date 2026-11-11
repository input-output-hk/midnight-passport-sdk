import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimReceipt, claimDigest } from '../src/midnames/claim-receipt.js';
import { confirmedClaim } from '../src/midnames/claim-finality.js';

const original = {
  networkId: 'undeployed',
  registryAddress: '12'.repeat(32),
  accountAddress: '34'.repeat(32),
  name: 'alice.night',
  ownerCommitment: '56'.repeat(32),
  transaction: { identifiers: ['78'.repeat(32)], sha256: '90'.repeat(32) },
} as const;

test('copies only the public original receipt fields and rejects ambiguous scopes', () => {
  assert.deepEqual(claimReceipt({ ...original, witness: 'discarded' }), original);
  for (const change of [
    { networkId: 'preview' },
    { name: 'alice.subdomain.night' },
    { name: 'alice.night\n' },
    { ownerCommitment: original.ownerCommitment.toUpperCase().replace('5', 'G') },
    { transaction: { ...original.transaction, identifiers: [] } },
    {
      transaction: {
        ...original.transaction,
        identifiers: [...original.transaction.identifiers, ...original.transaction.identifiers],
      },
    },
  ])
    assert.throws(() => claimReceipt({ ...original, ...change }), /Invalid standalone/);
});

test('requires an exact successful indexed claim, and looks up the original identifier', async () => {
  const row = {
    __typename: 'RegularTransaction',
    protocolVersion: 2001000,
    raw: '0001',
    hash: 'aa'.repeat(32),
    transactionResult: { status: 'SUCCESS' },
  };
  for (const value of [
    { data: { transactions: [] } },
    { data: { transactions: [row, row] } },
    { data: { transactions: [{ ...row, transactionResult: { status: 'PARTIAL_SUCCESS' } }] } },
    { data: { transactions: [{ ...row, protocolVersion: 2000000 }] } },
    { data: { transactions: [row] } }, // A different original digest.
  ]) {
    const calls: unknown[] = [];
    assert.equal(
      await confirmedClaim('http://127.0.0.1:1/graphql', original, async (_url, init) => {
        calls.push(JSON.parse(String(init?.body)).variables);
        return Response.json(value);
      }),
      false,
    );
    assert.deepEqual(calls, [{ offset: { identifier: original.transaction.identifiers[0] } }]);
  }
  const malformed = {
    ...original,
    transaction: {
      ...original.transaction,
      sha256: await claimDigest(Uint8Array.of(0, 1)),
    },
  };
  assert.equal(
    await confirmedClaim('http://127.0.0.1:1/graphql', malformed, async () =>
      Response.json({ data: { transactions: [row] } }),
    ),
    false,
  );
});
