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

test('grant submitter rejects an unrelated finalized transaction before staging or sending', async () => {
  const { createMidnightP256GrantSubmitter } =
    await import('../packages/adapter-midnight-js/dist/index.js');
  const bytes = (
    await ledger.Transaction.fromParts('undeployed').prove(
      {
        check: async () => [],
        prove: async () => new Uint8Array(),
        lookupKey: async () => undefined,
      },
      ledger.CostModel.initialCostModel(),
    )
  )
    .bind()
    .serialize();
  const reservation = {
    requestId: '549bd843-0a8f-40af-9b6f-d9eb8cf48871',
    intentSha256: '11'.repeat(32),
    account: '22'.repeat(32),
    grantId: '33'.repeat(32),
    networkId: 'undeployed',
    issuedAt: '0',
    previousNonce: '0',
    expectedSpentCommit: '44'.repeat(32),
  };
  const submitter = createMidnightP256GrantSubmitter({
    networkId: reservation.networkId,
    receipts: {
      readRecord: async () => ({ reservation }),
      stageTransaction: async () => assert.fail('unrelated call was staged'),
    },
    submitter: { submit: async () => assert.fail('unrelated call was sent') },
  });
  const context = {
    address: reservation.account,
    circuit: 'withdraw_unshielded_with_grant_p256',
    mutation: { requestId: reservation.requestId, intentSha256: reservation.intentSha256 },
  };
  await assert.rejects(submitter.submit(bytes, { ...context, circuit: 'deposit_unshielded' }), {
    code: 'BindingUnsupported',
  });
  await assert.rejects(submitter.submit(bytes, context), { code: 'MutationUnsettled' });
});
