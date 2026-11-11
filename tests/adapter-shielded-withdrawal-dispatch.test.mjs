import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createShieldedWithdrawalJournal, mutationDigest } from '../packages/account/dist/index.js';
import {
  prepareShieldedWithdrawalDispatch,
  stageShieldedWithdrawalDispatch,
  verifyShieldedWithdrawalCall,
} from '../packages/adapter-midnight-js/dist/shielded-withdrawal-dispatch.js';

const require = createRequire(
  new URL('../packages/adapter-midnight-js/package.json', import.meta.url),
);
const ledger = await import(require.resolve('@midnightntwrk/ledger-v9'));
const account = 'ab'.repeat(32);
const circuit = /** @type {const} */ ('withdraw_shielded_with_jubjub');
const networkId = 'undeployed';
const bindingId = /** @type {const} */ ('acc-s3r1.1');
const coin = {
  nonce: '11'.repeat(32),
  type: '22'.repeat(32),
  value: 17n,
  mt_index: 0n,
};
const heldCoin = {
  nonce: Uint8Array.from(Buffer.from(coin.nonce, 'hex')),
  color: Uint8Array.from(Buffer.from(coin.type, 'hex')),
  value: coin.value,
  mt_index: coin.mt_index,
};
const args = [{ bytes: new Uint8Array(32).fill(3) }, heldCoin.color, 5n, 'synthetic-signature'];
const source = ledger.ZswapOutput.newContractOwned(coin, undefined, account);
const state = new ledger.ZswapChainState()
  .tryApply(ledger.ZswapOffer.fromOutput(source))[0]
  .postBlockUpdate(new Date(), 3600n);
const input = ledger.ZswapInput.newContractOwned(coin, undefined, account, state);
const payout = ledger.ZswapOutput.new(
  { ...coin, nonce: '33'.repeat(32), value: 5n },
  undefined,
  ledger.sampleCoinPublicKey(),
  ledger.sampleEncryptionPublicKey(),
);
const changeCoin = { ...coin, nonce: '44'.repeat(32), value: 12n };
const change = ledger.ZswapOutput.newContractOwned(changeCoin, undefined, account);
const reservation = {
  requestId: '550e8400-e29b-41d4-a716-446655440000',
  networkId,
  bindingId,
  account,
  circuit,
  callArgsSha256: mutationDigest(args),
  heldCoinSha256: mutationDigest(heldCoin),
  inputNullifier: input.nullifier,
  payoutCommitment: payout.commitment,
  changeCommitment: change.commitment,
  change: { nonce: changeCoin.nonce, color: coin.type, value: changeCoin.value.toString() },
};
const pins = { networkId, bindingId };
const request = { address: account, circuit, args, heldCoin };

function memoryStore() {
  /** @type {Map<string, {revision: number, bytes: Uint8Array}>} */
  const rows = new Map();
  return /** @satisfies {import('../packages/account/dist/index.js').MutationByteStore} */ ({
    async read(key) {
      return structuredClone(rows.get(key));
    },
    async compareAndSwap(key, expected, next) {
      if (rows.get(key)?.revision !== expected) return false;
      rows.set(key, structuredClone(next));
      return true;
    },
  });
}

function transaction({
  claimChange = true,
  includeChange = true,
  extraOutput = false,
  offerInFalliblePhase = false,
} = {}) {
  const effect = {
    claimedNullifiers: [input.nullifier],
    claimedShieldedSpends: [payout.commitment, change.commitment],
    claimedShieldedReceives: claimChange ? [change.commitment] : [],
    claimedContractCalls: [],
    shieldedMints: new Map(),
    unshieldedMints: new Map(),
    unshieldedInputs: new Map(),
    unshieldedOutputs: new Map(),
    claimedUnshieldedSpends: new Map(),
  };
  const transcript = {
    effects: effect,
    gas: { readTime: 0n, computeTime: 0n, bytesWritten: 0n, bytesDeleted: 0n },
    program: [],
  };
  const empty = { value: [], alignment: [] };
  const call = new ledger.ContractCallPrototype(
    account,
    circuit,
    new ledger.ContractOperation(),
    transcript,
    undefined,
    [],
    empty,
    empty,
    ledger.communicationCommitmentRandomness(),
    'fixture',
  );
  let offer = ledger.ZswapOffer.fromInput(input).merge(ledger.ZswapOffer.fromOutput(payout));
  if (includeChange) offer = offer.merge(ledger.ZswapOffer.fromOutput(change));
  if (extraOutput) offer = offer.merge(ledger.ZswapOffer.fromOutput(source));
  return ledger.Transaction.fromParts(
    networkId,
    offerInFalliblePhase ? undefined : offer,
    offerInFalliblePhase ? offer : undefined,
    ledger.Intent.new(new Date(Date.now() + 60_000)).addCall(call),
  );
}

test('wallet admission owns and verifies the signed arguments and qualified coin before proving', async () => {
  const journal = createShieldedWithdrawalJournal(memoryStore(), memoryStore());
  assert.equal(await journal.reserve(reservation), true);
  const provided = structuredClone(request);
  const pending = prepareShieldedWithdrawalDispatch(reservation.requestId, provided, pins, journal);
  provided.args[2] = 6n;
  provided.heldCoin.nonce.fill(0);
  const admitted = await pending;
  assert.deepEqual(admitted.args, args);
  assert.deepEqual(admitted.heldCoin, heldCoin);
  for (const changed of [
    { ...request, args: provided.args },
    { ...request, heldCoin: provided.heldCoin },
    { ...request, heldCoin: { ...heldCoin, mt_index: 1n } },
    {
      ...request,
      heldCoin: {
        ...heldCoin,
        nonce: new Uint8Array(new SharedArrayBuffer(32)).fill(0x11),
      },
    },
  ]) {
    await assert.rejects(
      prepareShieldedWithdrawalDispatch(reservation.requestId, changed, pins, journal),
      { code: 'MutationUnsettled' },
    );
  }
});

test('Ledger 9 verifies the exact ACC call effects and concrete shielded offers', () => {
  const tx = transaction();
  const commitment = verifyShieldedWithdrawalCall(tx, reservation);
  assert.equal(verifyShieldedWithdrawalCall(tx, reservation, commitment), commitment);
  for (const changed of [
    transaction({ claimChange: false }),
    transaction({ includeChange: false }),
    transaction({ extraOutput: true }),
    transaction({ offerInFalliblePhase: true }),
  ]) {
    assert.throws(() => verifyShieldedWithdrawalCall(changed, reservation), {
      code: 'MutationUnsettled',
    });
  }
  assert.throws(() => verifyShieldedWithdrawalCall(transaction(), reservation, commitment), {
    code: 'MutationUnsettled',
  });
  assert.throws(
    () => verifyShieldedWithdrawalCall(tx, { ...reservation, inputNullifier: '55'.repeat(32) }),
    {
      code: 'MutationUnsettled',
    },
  );
});

test('wallet staging refuses unproven bytes and leaves the durable dispatch open', async () => {
  const journal = createShieldedWithdrawalJournal(memoryStore(), memoryStore());
  assert.equal(await journal.reserve(reservation), true);
  const tx = transaction();
  const commitment = verifyShieldedWithdrawalCall(tx, reservation);
  await assert.rejects(stageShieldedWithdrawalDispatch(tx, reservation, commitment, journal), {
    code: 'MutationUnsettled',
  });
  assert.equal((await journal.read(reservation.requestId))?.dispatch, undefined);
});
