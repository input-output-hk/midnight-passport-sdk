import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimReceipt, claimDigest, normalizeClaimName } from '../src/midnames/claim-receipt.js';
import type { AlignedValue, Op } from '@midnightntwrk/ledger-v9';
import { matchesClaimWrites } from '../src/midnames/claim-transcript.js';
import {
  confirmedClaim,
  failedSponsoredClaimSegment,
  readClaimFinality,
} from '../src/midnames/claim-finality.js';
import {
  claimQuote,
  claimQuoteDigest,
  reviewedDispatchQuote,
} from '../src/midnames/claim-quote.js';

const original = {
  networkId: 'undeployed',
  registryAddress: '12'.repeat(32),
  accountAddress: '34'.repeat(32),
  name: 'alice.night',
  ownerCommitment: '56'.repeat(32),
  transaction: { identifiers: ['00' + '78'.repeat(32)], sha256: '90'.repeat(32) },
} as const;

test('normalizes ASCII claim labels and refuses Unicode lookalikes and subdomains', () => {
  assert.equal(normalizeClaimName('  Alice-2.NIGHT  '), 'alice-2.night');
  assert.equal(normalizeClaimName('a.night'), 'a.night');
  for (const value of [
    'K.night',
    'аlice.night',
    '-alice.night',
    'alice-.night',
    'a.b.night',
    'a'.repeat(33) + '.night',
  ])
    assert.equal(normalizeClaimName(value), undefined, value);
});

test('copies only the public original receipt fields and rejects ambiguous scopes', () => {
  assert.deepEqual(claimReceipt({ ...original, witness: 'discarded' }), original);
  for (const change of [
    { networkId: 'preview' },
    { name: 'alice.subdomain.night' },
    { name: 'alice.night\n' },
    { ownerCommitment: original.ownerCommitment.toUpperCase().replace('5', 'G') },
    { transaction: { ...original.transaction, identifiers: [] } },
    { transaction: { ...original.transaction, identifiers: ['78'.repeat(32)] } },
    { transaction: { ...original.transaction, identifiers: ['0x' + '78'.repeat(32)] } },
    {
      transaction: {
        ...original.transaction,
        identifiers: [...original.transaction.identifiers, ...original.transaction.identifiers],
      },
    },
  ])
    assert.throws(() => claimReceipt({ ...original, ...change }), /Invalid standalone/);
});

test('only a saved exact quote can authorize a prepared receipt for send review', async () => {
  const quote = claimQuote({
    ...original,
    id: '91'.repeat(32),
    sponsorAddress: '92'.repeat(32),
    sponsorPaymentAddress: '95'.repeat(32),
    registryPayee: '93'.repeat(32),
    night: '7',
    maximumDust: '10000',
    expiresAt: Date.now() + 60_000,
  });
  const saved = { quote, ownerCommitment: original.ownerCommitment };
  const receipt = claimReceipt({ ...original, quoteSha256: await claimQuoteDigest(quote) });
  assert.deepEqual(await reviewedDispatchQuote(receipt, saved), quote);
  assert.equal(await reviewedDispatchQuote(claimReceipt(original), saved), undefined);
  assert.equal(await reviewedDispatchQuote(receipt, undefined), undefined);
  assert.equal(
    await reviewedDispatchQuote(receipt, {
      quote: { ...quote, night: '8' },
      ownerCommitment: original.ownerCommitment,
    }),
    undefined,
  );
  assert.equal(
    await reviewedDispatchQuote(receipt, { quote, ownerCommitment: 'ab'.repeat(32) }),
    undefined,
  );
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

test('only an isolated failed claim with a successful fee-only intent can unlock recovery', () => {
  const claim = {
    actions: [{}],
    fallibleUnshieldedOffer: {},
  };
  const fee = {
    actions: [],
    dustActions: { spends: [{}, {}], registrations: [] },
  };
  const tx = (intents: [number, object][], effects: object = {}) =>
    ({ intents: new Map(intents), ...effects }) as unknown as Parameters<
      typeof failedSponsoredClaimSegment
    >[0];
  const original = tx([
    [62361, claim],
    [1, fee],
  ]);
  const segments = [
    { id: 0, success: true },
    { id: 1, success: true },
    { id: 62361, success: false },
  ];
  assert.equal(failedSponsoredClaimSegment(original, segments), true);
  for (const different of [
    segments.slice(1),
    [...segments, { id: 9, success: true }],
    [segments[0], segments[1], segments[1]],
    [{ id: 0, success: false }, ...segments.slice(1)],
    [segments[0], { id: 1, success: false }, segments[2]],
    [segments[0], segments[1], { id: 62361, success: true }],
    [segments[0], segments[1], { id: '62361', success: false }],
  ])
    assert.equal(failedSponsoredClaimSegment(original, different), false);
  for (const different of [
    tx([[62361, claim]]),
    tx([
      [62361, claim],
      [1, fee],
      [9, fee],
    ]),
    tx([
      [62361, claim],
      [1, { ...fee, actions: [{}] }],
    ]),
    tx([
      [62361, claim],
      [1, { ...fee, dustActions: { spends: [{}], registrations: [] } }],
    ]),
    tx([
      [62361, { ...claim, fallibleUnshieldedOffer: undefined }],
      [1, fee],
    ]),
    tx(
      [
        [62361, claim],
        [1, fee],
      ],
      { rewards: {} },
    ),
  ])
    assert.equal(failedSponsoredClaimSegment(different, segments), false);
});

test('provider outage is distinct from an unconfirmed original claim', async () => {
  const indexer = 'http://127.0.0.1:1/graphql';
  assert.equal(
    await readClaimFinality(indexer, original, async () => {
      throw new Error('indexer offline');
    }),
    undefined,
  );
  assert.equal(
    await readClaimFinality(indexer, original, async () => new Response('', { status: 503 })),
    undefined,
  );
  assert.equal(
    await readClaimFinality(indexer, original, async () =>
      Response.json({ data: { transactions: [] } }),
    ),
    false,
  );
  assert.equal(
    await readClaimFinality(
      indexer,
      {
        ...original,
        transaction: { ...original.transaction, sha256: await claimDigest(Uint8Array.of(0, 1)) },
      },
      async () =>
        Response.json({
          data: {
            transactions: [
              {
                __typename: 'RegularTransaction',
                protocolVersion: 2001000,
                hash: 'aa'.repeat(32),
                raw: '0001',
                transactionResult: { status: 'FAILURE' },
              },
            ],
          },
        }),
    ),
    'conflict',
  );
});

test('the two registry inserts bind the root name, owner, child payee and ACC', () => {
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
    bytes('92'.repeat(32)),
    bytes(original.accountAddress),
    ...Array.from({ length: 10 }, () => number(0)),
  ];
  const nameInsert = insert(3, push(false, label, number(0)), push(true, number(1)));
  const domainInsert = insert(4, push(false, number(1)), push(true, ...domainFields));
  const program = [...nameInsert, ...domainInsert];
  const quoted = { ...original, sponsorAddress: '92'.repeat(32) };
  assert.equal(matchesClaimWrites([program], quoted), true);
  assert.equal(
    matchesClaimWrites([program], { ...quoted, sponsorAddress: 'ab'.repeat(32) }),
    false,
  );
  const changedPaymentAddress = [...domainFields];
  changedPaymentAddress[1] = bytes('ab'.repeat(32));
  assert.equal(
    matchesClaimWrites(
      [[...nameInsert, ...insert(4, push(false, number(1)), push(true, ...changedPaymentAddress))]],
      quoted,
    ),
    false,
  );
  for (const mismatch of [
    { name: 'bob.night' },
    { ownerCommitment: 'aa'.repeat(32) },
    { accountAddress: 'bb'.repeat(32) },
  ]) {
    assert.equal(matchesClaimWrites([program], { ...quoted, ...mismatch }), false);
  }
  assert.equal(
    matchesClaimWrites(
      [[...nameInsert, ...insert(4, push(false, number(2)), push(true, ...domainFields))]],
      quoted,
    ),
    false,
  );
});
