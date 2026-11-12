import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createShieldedWithdrawalJournal } from '../../packages/account/dist/index.js';
import { deriveMidnightContractCoinCommitment } from '../../packages/adapter-midnight-js/dist/index.js';
import { deriveAccS3r1ShieldedWithdrawal } from '../../packages/contract/dist/shielded-withdrawal.js';

function memoryStore() {
  /** @type {Map<string, {revision: number, bytes: Uint8Array}>} */
  const records = new Map();
  return /** @satisfies {import('../../packages/account/dist/index.js').MutationByteStore} */ ({
    async read(id) {
      const row = records.get(id);
      return row && { ...row, bytes: row.bytes.slice() };
    },
    async compareAndSwap(id, expected, next) {
      if (records.get(id)?.revision !== expected) return false;
      records.set(id, { ...next, bytes: next.bytes.slice() });
      return true;
    },
  });
}

const inputNullifier = '11'.repeat(32);
const payoutCommitment = '22'.repeat(32);
const txHash = '33'.repeat(32);
const dispatch = {
  identity: { txHash, bytesSha256: '44'.repeat(32), identifiers: ['55'.repeat(32)] },
  callCommitment: '66'.repeat(32),
};

/** @param {string} networkId */
export function partialWithdrawalFixture(networkId) {
  const journal = createShieldedWithdrawalJournal(memoryStore(), memoryStore());
  const state = {
    approve: true,
    finalized: false,
    reviews:
      /** @type {import('../../packages/account/dist/index.js').PartialShieldedWithdrawalReview[]} */ ([]),
    submissions: 0,
    duringReview: /** @type {(() => void) | undefined} */ (undefined),
  };
  /** @type {import('../../packages/account/dist/index.js').FinalizedShieldedWithdrawal | undefined} */
  let observation;
  /** @type {import('../../packages/account/dist/index.js').PartialShieldedWithdrawalHost} */
  const host = {
    journal,
    deriveChangeCommitment: deriveMidnightContractCoinCommitment,
    async predict({ coin, amount }) {
      const { change } = await deriveAccS3r1ShieldedWithdrawal(coin, amount);
      assert.ok(change);
      return { inputNullifier, payoutCommitment, change };
    },
    async reviewWithdrawal(review) {
      state.reviews.push(review);
      state.duringReview?.();
      return state.approve;
    },
    async submitOriginal(requestId, call) {
      const record = await journal.read(requestId);
      assert.ok(record?.reservation.heldCoinSha256 && call.heldCoin);
      const reservation = {
        ...record.reservation,
        heldCoinSha256: record.reservation.heldCoinSha256,
      };
      assert.ok(journal.matchesInvocation(reservation, call.args, call.heldCoin));
      assert.equal(call.circuit, reservation.circuit);
      assert.equal(call.args[2], 6n);
      assert.ok(await journal.stageDispatch(reservation, dispatch));
      state.submissions++;
      observation = {
        dispatch,
        bindingId: reservation.bindingId,
        blockHash: '77'.repeat(32),
        blockHeight: 10,
        account: reservation.account,
        circuit: reservation.circuit,
        inputNullifier,
        outputCommitments: [payoutCommitment, reservation.changeCommitment],
        changeOutput: {
          account: reservation.account,
          commitment: reservation.changeCommitment,
          index: 15n,
        },
      };
      throw new Error('lost response after staging');
    },
    finality: {
      networkId,
      bindingId: 'acc-s3r1.1',
      async readFinalized(identity) {
        assert.deepEqual(identity, dispatch.identity);
        return state.finalized ? observation : undefined;
      },
    },
  };
  return { host, state };
}

/**
 * @param {import('../../packages/protocol/dist/index.js').PassportAccount} account
 * @param {import('../../packages/protocol/dist/index.js').PassportShieldedWithdrawal} exact
 * @param {ReturnType<typeof partialWithdrawalFixture>} fixture
 * @param {() => number} signatures
 * @param {(delta: bigint) => void} changeNonce
 */
export async function exercisePartialWithdrawal(
  account,
  exact,
  { host, state },
  signatures,
  changeNonce,
) {
  assert.ok(account.withdrawShieldedPartial);
  const request = { ...exact, requestId: randomUUID(), amount: '6' };
  const before = signatures();
  await assert.rejects(account.withdrawShieldedPartial({ ...request, amount: exact.amount }), {
    code: 'TransferInvalid',
  });
  assert.deepEqual(state.reviews, []);
  state.approve = false;
  await assert.rejects(account.withdrawShieldedPartial(request), { code: 'UserCancelled' });
  assert.deepEqual(state.reviews[0], {
    ...request,
    account: account.address,
    networkId: host.finality.networkId,
    bindingId: 'acc-s3r1.1',
    changeAmount: '1',
  });
  state.approve = true;
  state.duringReview = () => changeNonce(1n);
  await assert.rejects(account.withdrawShieldedPartial(request), { code: 'MutationUnsettled' });
  changeNonce(-1n);
  state.duringReview = undefined;
  assert.equal(signatures(), before);
  assert.equal(await host.journal.read(request.requestId), undefined);

  const pending = { kind: 'withdrawal-pending', requestId: request.requestId };
  assert.deepEqual(await account.withdrawShieldedPartial(request), pending);
  assert.deepEqual(await account.withdrawShieldedPartial(request), pending);
  state.finalized = true;
  assert.deepEqual(await account.withdrawShieldedPartial(request), {
    kind: 'change-pending',
    requestId: request.requestId,
    txHash,
  });
  assert.equal(state.submissions, 1);
  assert.equal(state.reviews.length, 3);
  assert.equal(signatures(), before + 1);
}
