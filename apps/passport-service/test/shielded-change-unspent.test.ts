import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Ledger from '@midnightntwrk/ledger-v9';
import { toHex } from '../../../packages/account/dist/index.js';
import type { ShieldedWithdrawalRecoveryPorts } from '../../../packages/account/dist/index.js';
import { AmountSchema, NetworkIdSchema } from '../../../packages/account/dist/validation.js';
import { createShieldedChangeUnspentCheck } from '../src/shielded-change-unspent.ts';

const nodeUrl = 'http://localhost:19964';
const networkId = NetworkIdSchema.parse('undeployed');
const bindingId = 'acc-s3r1.1' as const;
const account = 'ab'.repeat(32);
const requestId = 'a31a8c9b-c11d-4860-91b9-5ea65e0cf50c';
const block = 'f1'.repeat(32);
const nextBlock = 'f2'.repeat(32);
const withdrawalBlock = 'f0'.repeat(32);
const coin = { nonce: new Uint8Array(32).fill(11), color: new Uint8Array(32).fill(12), value: 10n };
const wire = { nonce: toHex(coin.nonce), type: toHex(coin.color), value: coin.value };

function setup() {
  const change = Ledger.ZswapOutput.newContractOwned(wire, undefined, account);
  const other = Ledger.ZswapOutput.newContractOwned(
    { ...wire, nonce: 'cd'.repeat(32) },
    undefined,
    account,
  );
  const offer = Ledger.ZswapOffer.fromOutput(change).merge(Ledger.ZswapOffer.fromOutput(other));
  const [initial, indices] = new Ledger.ZswapChainState().tryApply(offer);
  const mt_index = indices.get(change.commitment);
  const otherIndex = indices.get(other.commitment);
  assert.ok(mt_index !== undefined && otherIndex !== undefined);
  const state = initial.postBlockUpdate(new Date(), 3600n);
  const input = Ledger.ZswapInput.newContractOwned(
    { ...wire, mt_index },
    undefined,
    account,
    state,
  );
  const [spent] = state.tryApply(Ledger.ZswapOffer.fromInput(input));
  const qualified = { ...coin, mt_index };
  const circuit = 'withdraw_shielded_with_p256' as const;
  const reservation = {
    requestId,
    networkId,
    bindingId,
    account,
    circuit,
    callArgsSha256: '13'.repeat(32),
    inputNullifier: '14'.repeat(32),
    payoutCommitment: '15'.repeat(32),
    changeCommitment: change.commitment,
    change: { nonce: wire.nonce, color: wire.type, value: AmountSchema.parse('10') },
  };
  const dispatch = {
    identity: {
      txHash: '16'.repeat(32),
      bytesSha256: '17'.repeat(32),
      identifiers: ['18'.repeat(32)],
    },
    callCommitment: '19'.repeat(32),
  };
  const withdrawal: ShieldedWithdrawalRecoveryPorts = {
    journal: { read: async () => ({ reservation, dispatch }) },
    deriveChangeCommitment(address, coin) {
      return Ledger.ZswapOutput.newContractOwned(
        { nonce: toHex(coin.nonce), type: toHex(coin.color), value: coin.value },
        undefined,
        address,
      ).commitment;
    },
    finality: {
      networkId,
      bindingId,
      async readFinalized(identity) {
        assert.deepEqual(identity, dispatch.identity);
        return {
          dispatch,
          bindingId,
          blockHash: withdrawalBlock,
          blockHeight: 10,
          account,
          circuit,
          inputNullifier: reservation.inputNullifier,
          outputCommitments: [reservation.payoutCommitment, change.commitment],
          changeOutput: { account, commitment: change.commitment, index: mt_index },
        };
      },
    },
  };
  return { qualified, otherIndex, state, spent, withdrawal };
}

test('host dry-runs the exact change against authenticated, unchanged best-block state', async () => {
  const f = setup();
  const calls: string[] = [];
  let state = f.state;
  let stateBlock = block;
  let best = block;
  let moveTip = false;
  let available = true;
  const isUnspent = createShieldedChangeUnspentCheck(requestId, f.withdrawal, {
    nodeUrl,
    networkId,
    ledger: Ledger,
    async fetch(url, init) {
      assert.equal(url, nodeUrl);
      assert.equal(init?.redirect, 'error');
      assert.ok(typeof init?.body === 'string');
      assert.deepEqual(JSON.parse(init.body), {
        jsonrpc: '2.0',
        id: 1,
        method: 'chain_getBlockHash',
        params: [],
      });
      calls.push('best');
      return Response.json({ id: 1, result: '0x' + best });
    },
    stateSource: {
      networkId,
      async readAuthenticatedState(hash) {
        assert.equal(hash, block);
        calls.push('state');
        if (moveTip) best = nextBlock;
        return available ? { blockHash: stateBlock, state } : undefined;
      },
    },
  });
  const originalState = f.state.serialize();
  assert.equal(await isUnspent(account, f.qualified), true);
  assert.deepEqual(
    f.state.serialize(),
    originalState,
    'the probe does not consume the chain state',
  );
  assert.deepEqual(calls.splice(0), ['best', 'state', 'best']);
  assert.equal(await isUnspent(account, { ...f.qualified, mt_index: f.otherIndex }), false);
  assert.deepEqual(calls.splice(0), [], 'a different occupied index cannot be qualified');
  assert.equal(await isUnspent(account, { ...f.qualified, value: 11n }), false);
  assert.deepEqual(calls.splice(0), []);
  state = f.spent;
  assert.equal(await isUnspent(account, f.qualified), false);
  assert.deepEqual(calls.splice(0), ['best', 'state']);
  state = f.state;
  stateBlock = nextBlock;
  assert.equal(await isUnspent(account, f.qualified), false);
  assert.deepEqual(calls.splice(0), ['best', 'state']);
  stateBlock = block;
  available = false;
  assert.equal(await isUnspent(account, f.qualified), false);
  assert.deepEqual(calls.splice(0), ['best', 'state']);
  available = true;
  moveTip = true;
  assert.equal(await isUnspent(account, f.qualified), false);
  assert.deepEqual(calls.splice(0), ['best', 'state', 'best']);
});
