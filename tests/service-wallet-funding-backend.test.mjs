import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWalletFundingBackend } from '../packages/service/dist/index.js';

/** @typedef {import('../packages/service/dist/index.js').FundingProgress} FundingProgress */

const address = 'ab'.repeat(32);
const colorHex = 'cd'.repeat(32);
const request = {
  requestId: '12345678-1234-1234-1234-123456789abc',
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: 'ef'.repeat(32),
  accountAddress: address,
  color: colorHex,
  amount: '10',
};

test('wallet backend submits a permissionless deposit and waits for the ACC credit', async () => {
  let readsAfterSubmit = 0;
  /** @type {Array<{color: string, amount: bigint}>} */
  const deposits = [];
  const account = {
    async ledgerState() {
      const balance = deposits.length && ++readsAfterSubmit >= 2 ? 10n : 0n;
      return {
        spec_version: 3n,
        unshielded_balances: {
          member: () => balance > 0n,
          lookup: () => balance,
        },
      };
    },
    /** @param {Uint8Array} color @param {bigint} amount */
    async depositUnshielded(color, amount) {
      deposits.push({ color: Buffer.from(color).toString('hex'), amount });
      return { txId: 'tx-1' };
    },
  };
  const backend = createWalletFundingBackend({
    deployed: (a) => a === address,
    connect: async () => account,
    prepareDeposit: async (color, amount) => {
      assert.equal(Buffer.from(color).toString('hex'), colorHex);
      assert.equal(amount, 10n);
      assert.equal(deposits.length, 0, 'wallet preparation precedes ACC submission');
      return 'preparation-tx';
    },
    sleep: async () => {},
    pollMs: 1,
  });
  assert.equal(await backend.eligible(address), true);
  /** @type {FundingProgress[]} */
  const progress = [];
  assert.deepEqual(
    await backend.fund(request, async (event) => {
      progress.push(event);
    }),
    {
      requestId: request.requestId,
      txId: 'tx-1',
      preparationTxId: 'preparation-tx',
      creditedBalance: '10',
    },
  );
  assert.deepEqual(deposits, [{ color: colorHex, amount: 10n }]);
  assert.equal(readsAfterSubmit, 2);
  assert.deepEqual(progress, [
    { stage: 'balance-observed', balanceBefore: '0' },
    { stage: 'prepared', preparationTxId: 'preparation-tx' },
    { stage: 'submitted', txId: 'tx-1' },
  ]);
});

test('wallet backend rejects unlisted and wrong-version contracts before spending', async () => {
  let connected = 0;
  let deposited = 0;
  const backend = createWalletFundingBackend({
    deployed: (a) => a === address,
    connect: async () => {
      connected++;
      return {
        ledgerState: async () => ({
          spec_version: 2n,
          unshielded_balances: { member: () => false, lookup: () => 0n },
        }),
        depositUnshielded: async () => {
          deposited++;
          return { txId: 'tx-1' };
        },
      };
    },
  });
  assert.equal(await backend.eligible('00'.repeat(32)), false);
  assert.equal(connected, 0);
  assert.equal(await backend.eligible(address), false);
  await assert.rejects(backend.fund(request), /eligible deployed binding/);
  assert.equal(deposited, 0);
});

test('an unconfirmed credit fails while the route keeps its reservation pending', async () => {
  let clock = 0;
  const backend = createWalletFundingBackend({
    deployed: () => true,
    connect: async () => ({
      ledgerState: async () => ({
        spec_version: 3n,
        unshielded_balances: { member: () => false, lookup: () => 0n },
      }),
      depositUnshielded: async () => ({ txId: 'tx-1' }),
    }),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    pollMs: 1,
    confirmationMs: 2,
  });
  await assert.rejects(backend.fund(request), /not confirmed/);
});
