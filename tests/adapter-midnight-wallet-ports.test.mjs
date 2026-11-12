import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  createMidnightChain,
  createMidnightWalletPorts,
} from '../packages/adapter-midnight-js/dist/index.js';

const ledger = await import(
  pathToFileURL(
    createRequire(new URL('../packages/adapter-midnight-js/package.json', import.meta.url)).resolve(
      '@midnightntwrk/ledger-v9',
    ),
  ).href
);

test('wallet ports carry real v9 transaction bytes through balance and submit', async () => {
  const unbound = await ledger.Transaction.fromParts('undeployed').prove(
    {
      check: async () => [],
      prove: async () => new Uint8Array(),
      lookupKey: async () => undefined,
    },
    ledger.CostModel.initialCostModel(),
  );
  const bound = unbound.bind();
  /** @type {string[]} */
  const calls = [];
  const ports = createMidnightWalletPorts(
    {
      supportedEras: ['v9'],
      getCoinPublicKey: () => 'coin-key',
      getEncryptionPublicKey: () => 'encryption-key',
      async balanceTx(input) {
        calls.push('balance');
        assert.equal(input.version, 'v9');
        assert.deepEqual(input.tx.serialize(), unbound.serialize());
        return { version: 'v9', tx: bound };
      },
    },
    {
      supportedEras: ['v9'],
      async submitTx(input) {
        calls.push('submit');
        assert.equal(input.version, 'v9');
        assert.deepEqual(input.tx.serialize(), bound.serialize());
        return 'submitted-id';
      },
    },
  );
  assert.deepEqual(ports.sponsorKeys, {
    coinPublicKey: 'coin-key',
    encryptionPublicKey: 'encryption-key',
  });
  assert.equal(ports.sponsor.supportsShieldedOffers, true);
  const balanced = await ports.sponsor.balanceAndSign(unbound.serialize());
  assert.deepEqual(balanced, bound.serialize());
  assert.equal(await ports.submitter.submit(balanced), 'submitted-id');
  assert.deepEqual(calls, ['balance', 'submit']);
});

test('wallet ports refuse providers that cannot handle v9', () => {
  const wallet = {
    supportedEras: /** @type {const} */ (['v9']),
    getCoinPublicKey: () => 'coin-key',
    getEncryptionPublicKey: () => 'encryption-key',
    balanceTx: async () => {
      throw new Error('unused');
    },
  };
  const submitter = {
    supportedEras: /** @type {const} */ (['v8']),
    submitTx: async () => {
      throw new Error('unused');
    },
  };
  assert.throws(() => createMidnightWalletPorts(wallet, submitter), {
    code: 'BindingUnsupported',
  });
});

test('a known fee-only sponsor rejects a shielded spend before proving', async () => {
  let proved = false;
  const chain = createMidnightChain({
    network: {
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      manifestSha256: 'a'.repeat(64),
      indexerUrl: 'http://localhost/graphql',
      indexerWsUrl: 'ws://localhost/graphql',
      nodeUrl: 'http://localhost:9944',
      artefactUrl: 'http://localhost/zk',
    },
    binding: /** @type {any} */ ({ Contract: class {}, ledger: () => ({}), pureCircuits: {} }),
    prover: {
      proveTx: async () => {
        proved = true;
        throw new Error('proving must not start');
      },
    },
    sponsor: { supportsShieldedOffers: false, balanceAndSign: async () => new Uint8Array() },
    sponsorKeys: { coinPublicKey: 'coin-key', encryptionPublicKey: 'encryption-key' },
    submitter: { submit: async () => 'never' },
    publicDataProvider: /** @type {any} */ ({ queryContractState: async () => null }),
  });
  await assert.rejects(
    chain.call({
      address: 'a'.repeat(64),
      circuit: 'withdraw_shielded_with_p256',
      args: [],
      heldCoin: {
        nonce: new Uint8Array(32),
        color: new Uint8Array(32),
        value: 9n,
        mt_index: 1n,
      },
    }),
    { code: 'BindingUnsupported', message: /value-capable wallet/ },
  );
  assert.equal(proved, false);
});

test('submission progress retains the original accepted ID before a later call failure', async () => {
  const unbound = await ledger.Transaction.fromParts('undeployed').prove(
    {
      check: async () => [],
      prove: async () => new Uint8Array(),
      lookupKey: async () => undefined,
    },
    ledger.CostModel.initialCostModel(),
  );
  const bound = unbound.bind();
  /** @type {import('../packages/protocol/dist/index.js').PassportEvent[]} */
  const seen = [];
  const unused = async () => {
    throw Error('unused');
  };
  const chain = createMidnightChain({
    network: {
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      manifestSha256: 'a'.repeat(64),
      indexerUrl: 'http://indexer',
      indexerWsUrl: 'ws://indexer',
      nodeUrl: 'http://node',
      artefactUrl: 'http://artefacts',
    },
    binding: /** @type {any} */ ({ Contract: class {}, ledger: () => ({}), pureCircuits: {} }),
    prover: { proveTx: unused },
    sponsor: { balanceAndSign: unused },
    sponsorKeys: { coinPublicKey: 'coin', encryptionPublicKey: 'enc' },
    submitter: { submit: async () => 'ab'.repeat(32) },
    publicDataProvider: /** @type {any} */ ({}),
    submit: /** @type {any} */ (
      async (/** @type {any} */ providers) => {
        await providers.midnightProvider.submitTx({ version: 'v9', tx: bound });
        throw Error('later call interrupted');
      }
    ),
  });
  await assert.rejects(
    chain.call({
      address: 'cd'.repeat(32),
      circuit: 'rotate_enc_key_with_jubjub',
      args: [],
      onEvent: (e) => seen.push(e),
    }),
    /later call interrupted/,
  );
  const submitted = seen.find((e) => e.step === 'sponsor.submit' && e.phase === 'end');
  assert.ok(submitted);
  assert.deepEqual(submitted.detail, {
    txId: 'ab'.repeat(32),
    circuit: 'rotate_enc_key_with_jubjub',
  });
  assert.equal(seen.filter((e) => e.id === submitted.id).length, 2);
});

test('grant dispatch rejects another invocation with the same payout before proving', async () => {
  const { prepareP256GrantDispatch, forwardP256GrantCall } =
    await import('../packages/adapter-midnight-js/dist/p256-grant-submitter.js');
  const { createP256GrantSpendJournal, mutationDigest } =
    await import('../packages/account/dist/index.js');
  const tx = (
    await ledger.Transaction.fromParts('undeployed').prove(
      {
        check: async () => [],
        prove: async () => new Uint8Array(),
        lookupKey: async () => undefined,
      },
      ledger.CostModel.initialCostModel(),
    )
  ).bind();
  const args = [new Uint8Array(32), 4n, { bytes: new Uint8Array(32).fill(9) }, 7n];
  const reservation = {
    requestId: '549bd843-0a8f-40af-9b6f-d9eb8cf48871',
    intentSha256: '11'.repeat(32),
    account: '22'.repeat(32),
    grantId: '33'.repeat(32),
    networkId: 'undeployed',
    issuedAt: '0',
    previousNonce: '0',
    color: '00'.repeat(32),
    amount: '4',
    recipient: '99'.repeat(32),
    expectedSpentCommit: '44'.repeat(32),
    callArgsSha256: mutationDigest(args),
  };
  /** @type {{revision: number, bytes: Uint8Array} | undefined} */
  let row;
  const journal = createP256GrantSpendJournal({
    async read() {
      return row;
    },
    async compareAndSwap(_key, revision, next) {
      if (row?.revision !== revision) return false;
      row = next;
      return true;
    },
  });
  assert.equal(await journal.reserve(reservation), true);
  const request = {
    address: reservation.account,
    args,
    mutation: { requestId: reservation.requestId, intentSha256: reservation.intentSha256 },
  };
  await assert.rejects(
    prepareP256GrantDispatch(
      { ...request, args: [...args.slice(0, 3), 8n] },
      'undeployed',
      journal,
    ),
    { code: 'MutationUnsettled' },
  );
  const admitted = await prepareP256GrantDispatch(request, 'undeployed', journal);
  assert.deepEqual(admitted.args, args);
  args[3] = 8n;
  assert.equal(admitted.args[3], 7n);
  await assert.rejects(
    forwardP256GrantCall(
      tx,
      admitted.reservation,
      'substituted',
      journal,
      { submit: async () => assert.fail('unrelated call was sent') },
      undefined,
    ),
    { code: 'MutationUnsettled' },
  );
  assert.equal((await journal.readRecord(reservation.requestId))?.transaction, undefined);
});

test('grant call comparison refuses changed commitments and payouts', async () => {
  const { checkGrantCommitment, checkGrantPayout } =
    await import('../packages/adapter-midnight-js/dist/p256-grant-call.js');
  const original = { color: '00'.repeat(32), recipient: '11'.repeat(32), amount: '4' };
  const call = /** @type {any} */ ({
    communicationCommitment: 'original-call-commitment',
    guaranteedTranscript: {
      effects: {
        claimedUnshieldedSpends: [
          [
            [
              { tag: 'unshielded', raw: original.color },
              { tag: 'user', address: original.recipient },
            ],
            4n,
          ],
        ],
      },
    },
  });
  checkGrantCommitment(call, 'original-call-commitment');
  checkGrantPayout(call, original);
  assert.throws(() => checkGrantCommitment(call, 'replacement-call-commitment'), {
    code: 'MutationUnsettled',
  });
  for (const replacement of [
    { ...original, amount: '5' },
    { ...original, color: '22'.repeat(32) },
    { ...original, recipient: '33'.repeat(32) },
  ]) {
    assert.throws(() => checkGrantPayout(call, replacement), { code: 'MutationUnsettled' });
  }
});

test('a shared chain keeps basic JubJub spending and refuses an unreserved durable call', async () => {
  const { createDurableAgentGrantSpendChain } =
    await import('../packages/adapter-midnight-js/dist/index.js');
  const { createAgentGrantSpendJournal } = await import('../packages/account/dist/index.js');
  let reads = 0;
  let calls = 0;
  const unavailable = async () => assert.fail('Unexpected provider or receipt mutation.');
  const chain = createDurableAgentGrantSpendChain({
    network: {
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      manifestSha256: 'a'.repeat(64),
      indexerUrl: 'http://indexer',
      indexerWsUrl: 'ws://indexer',
      nodeUrl: 'http://node',
      artefactUrl: 'http://artefacts',
    },
    binding: /** @type {any} */ ({ Contract: class {}, ledger: () => ({}), pureCircuits: {} }),
    prover: { proveTx: unavailable },
    sponsor: { balanceAndSign: unavailable },
    sponsorKeys: { coinPublicKey: 'coin', encryptionPublicKey: 'enc' },
    submitter: { submit: unavailable },
    publicDataProvider: /** @type {any} */ ({}),
    agentGrantReceipts: createAgentGrantSpendJournal({
      async read() {
        reads++;
        return undefined;
      },
      compareAndSwap: unavailable,
    }),
    submit: /** @type {any} */ (
      async () => {
        calls++;
        return { public: { txHash: 'ab'.repeat(32), blockHeight: 7 } };
      }
    ),
  });
  const basic = {
    address: 'a1'.repeat(32),
    circuit: /** @type {const} */ ('withdraw_unshielded_with_grant_jubjub'),
    args: [],
  };
  assert.deepEqual(await chain.call(basic), { txHash: 'ab'.repeat(32), blockHeight: 7 });
  assert.deepEqual([reads, calls], [0, 1]);
  await assert.rejects(
    chain.submitDurableAgentGrantSpend({
      ...basic,
      mutation: {
        requestId: '549bd843-0a8f-40af-9b6f-d9eb8cf48871',
        intentSha256: '19'.repeat(32),
        validUntilSeconds: Math.floor(Date.now() / 1000) + 60,
      },
    }),
    { code: 'MutationUnsettled' },
  );
  assert.deepEqual([reads, calls], [1, 1]);
});
