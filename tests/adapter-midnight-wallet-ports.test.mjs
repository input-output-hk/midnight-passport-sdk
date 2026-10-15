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
