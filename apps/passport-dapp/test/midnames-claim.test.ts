import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimReceipt, claimDigest } from '../src/midnames/claim-receipt.js';
import type { AlignedValue, Op } from '@midnightntwrk/ledger-v9';
import { matchesClaimWrites } from '../src/midnames/claim-transcript.js';
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

test('the two registry inserts must bind the same root name, domain ID, owner and ACC', () => {
  const value = (...bytes: Uint8Array[]) => ({
    value: bytes,
    alignment: [],
  });
  const number = (n: number) => (n === 0 ? new Uint8Array() : Uint8Array.of(n));
  const bytes = (hex: string) => Uint8Array.from(Buffer.from(hex, 'hex'));
  const push = (storage: boolean, ...parts: Uint8Array[]): Op<AlignedValue> => ({
    push: { storage, value: { tag: 'cell', content: value(...parts) } },
  });
  const insert = (
    slot: number,
    key: Op<AlignedValue>,
    item: Op<AlignedValue>,
  ): Op<AlignedValue>[] => [
    {
      idx: { cached: false, pushPath: false, path: [{ tag: 'value', value: value(number(slot)) }] },
    },
    key,
    item,
    { ins: { cached: false, n: 1 } },
  ];
  const label = new Uint8Array(32).fill(255);
  label.set(new TextEncoder().encode('alice'));
  const domainFields = [
    bytes(original.ownerCommitment),
    bytes('ab'.repeat(32)),
    bytes(original.accountAddress),
    ...Array.from({ length: 10 }, () => number(0)),
  ];
  const nameInsert = insert(3, push(false, label, number(0)), push(true, number(1)));
  const domainInsert = insert(4, push(false, number(1)), push(true, ...domainFields));
  const program = [...nameInsert, ...domainInsert];
  assert.equal(matchesClaimWrites([program], original), true);
  for (const mismatch of [
    { name: 'bob.night' },
    { ownerCommitment: 'aa'.repeat(32) },
    { accountAddress: 'bb'.repeat(32) },
  ]) {
    assert.equal(matchesClaimWrites([program], { ...original, ...mismatch }), false);
  }
  assert.equal(
    matchesClaimWrites(
      [[...nameInsert, ...insert(4, push(false, number(2)), push(true, ...domainFields))]],
      original,
    ),
    false,
  );
});
