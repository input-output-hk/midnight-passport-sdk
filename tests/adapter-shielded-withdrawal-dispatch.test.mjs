import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import {
  createShieldedWithdrawalJournal,
  mutationDigest,
  recoverShieldedWithdrawal,
} from '../packages/account/dist/index.js';
import {
  prepareShieldedWithdrawalDispatch,
  stageShieldedWithdrawalDispatch,
  submitStagedShieldedWithdrawal,
  verifyShieldedWithdrawalCall,
} from '../packages/adapter-midnight-js/dist/shielded-withdrawal-dispatch.js';

import { createMidnightPartialShieldedWithdrawalHost } from '../packages/adapter-midnight-js/dist/index.js';

const require = createRequire(
  new URL('../packages/adapter-midnight-js/package.json', import.meta.url),
);
const ledger = await import(require.resolve('@midnightntwrk/ledger-v9'));
const account = 'ab'.repeat(32);
const circuit = /** @type {const} */ ('withdraw_shielded_with_jubjub');
const { files } = JSON.parse(
  gunzipSync(
    await readFile(
      new URL('../packages/contract/resources/acc-s3r1.1.zkir.json.gz', import.meta.url),
    ),
  ).toString(),
);
/** @param {string} name */
const resource = (name) =>
  Buffer.from(files[name] ?? assert.fail('Missing fixture artifact.'), 'base64');
const fixtureProving = {
  check: async () => [],
  // Dummy proof for testing the pinned wire format, with no native proof claim.
  prove: async () => new ledger.Proof('0100').serialize(),
  lookupKey: async () => ({
    proverKey: new Uint8Array(),
    verifierKey: resource('keys/' + circuit + '.verifier'),
    ir: resource('zkir/' + circuit + '.bzkir'),
  }),
};
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
const payoutRecipient = ledger.sampleCoinPublicKey();
const payoutEncryptionKey = ledger.sampleEncryptionPublicKey();
const payout = ledger.ZswapOutput.new(
  { ...coin, nonce: '33'.repeat(32), value: 5n },
  undefined,
  payoutRecipient,
  payoutEncryptionKey,
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
  payoutOutput = payout,
  randomness = ledger.communicationCommitmentRandomness(),
  network = networkId,
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
    randomness,
    'fixture',
  );
  let offer = ledger.ZswapOffer.fromInput(input).merge(ledger.ZswapOffer.fromOutput(payoutOutput));
  if (includeChange) offer = offer.merge(ledger.ZswapOffer.fromOutput(change));
  if (extraOutput) offer = offer.merge(ledger.ZswapOffer.fromOutput(source));
  return ledger.Transaction.fromParts(
    network,
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

function privateChange() {
  return {
    is_some: true,
    value: {
      nonce: Uint8Array.from(Buffer.from(changeCoin.nonce, 'hex')),
      color: Uint8Array.from(Buffer.from(changeCoin.type, 'hex')),
      value: changeCoin.value,
    },
  };
}

/** @param {ReturnType<typeof createShieldedWithdrawalJournal>} journal */
function stagedRuntime(journal) {
  const status = { builds: 0, proves: 0, balances: 0, submissions: 0 };
  /** @type {Parameters<typeof submitStagedShieldedWithdrawal>[2]} */
  const runtime = {
    ...pins,
    journal,
    async build(invocation) {
      status.builds++;
      assert.deepEqual(invocation, request);
      return { private: { unprovenTx: transaction(), result: privateChange() } };
    },
    prover: {
      async proveTx(bytes, context) {
        status.proves++;
        assert.deepEqual(context.circuits, [circuit]);
        const unsigned = ledger.Transaction.deserialize(
          'signature',
          'pre-proof',
          'pre-binding',
          bytes,
        );
        const proved = await unsigned.prove(fixtureProving, ledger.CostModel.initialCostModel());
        return { tx: proved.serialize(), provenance: 'local' };
      },
    },
    wallet: {
      supportsShieldedOffers: true,
      async balanceAndSign(bytes) {
        status.balances++;
        return ledger.Transaction.deserialize('signature', 'proof', 'pre-binding', bytes)
          .bind()
          .serialize();
      },
    },
    submitter: {
      async submit(bytes) {
        status.submissions++;
        const tx = ledger.Transaction.deserialize('signature', 'proof', 'binding', bytes);
        const retained = (await journal.read(reservation.requestId))?.dispatch;
        assert.deepEqual(retained?.identity, {
          txHash: tx.transactionHash(),
          identifiers: tx.identifiers(),
          bytesSha256: createHash('sha256').update(bytes).digest('hex'),
        });
        return tx.identifiers()[0] ?? assert.fail('Missing finalized transaction identifier.');
      },
    },
  };
  return { runtime, status };
}

test('partial owner host predicts only its pinned wallet payout and dispatches the reserved call', async () => {
  const journal = createShieldedWithdrawalJournal(memoryStore(), memoryStore());
  const { runtime, status } = stagedRuntime(journal);
  const host = createMidnightPartialShieldedWithdrawalHost({
    ...runtime,
    walletKeys: { coinPublicKey: payoutRecipient, encryptionPublicKey: payoutEncryptionKey },
    finality: { ...pins, readFinalized: async () => undefined },
    holdingIndexer: {
      coinNullifier: async (address, coin, index) => {
        assert.equal(address, account);
        assert.deepEqual(coin, heldCoin);
        assert.equal(index, heldCoin.mt_index);
        return input.nullifier;
      },
    },
    deriveWithdrawalCoins: async (coin, amount) => {
      assert.deepEqual(coin, heldCoin);
      assert.equal(amount, 5n);
      return {
        sent: { ...heldCoin, nonce: new Uint8Array(32).fill(0x33), value: amount },
        change: privateChange().value,
      };
    },
    reviewWithdrawal: async () => true,
  });
  const prediction = { account, coin: heldCoin, amount: 5n, recipient: payoutRecipient };
  await assert.rejects(host.predict({ ...prediction, recipient: ledger.sampleCoinPublicKey() }), {
    code: 'TransferInvalid',
  });
  const effects = await host.predict(prediction);
  assert.deepEqual(effects, {
    inputNullifier: reservation.inputNullifier,
    payoutCommitment: reservation.payoutCommitment,
    change: privateChange().value,
  });
  assert.equal(host.deriveChangeCommitment(account, effects.change), reservation.changeCommitment);
  assert.equal(await journal.reserve(reservation), true);
  await host.submitOriginal(reservation.requestId, request);
  assert.deepEqual(status, { builds: 1, proves: 1, balances: 1, submissions: 1 });
});

test('one staged withdrawal wins concurrent submission and returns only the original identifiers', async () => {
  const journal = createShieldedWithdrawalJournal(memoryStore(), memoryStore());
  assert.equal(await journal.reserve(reservation), true);
  const { runtime, status } = stagedRuntime(journal);
  const submit = () => submitStagedShieldedWithdrawal(reservation.requestId, request, runtime);
  const outcomes = await Promise.allSettled([submit(), submit()]);
  const succeeded = outcomes.filter((outcome) => outcome.status === 'fulfilled');
  assert.equal(succeeded.length, 1);
  assert.equal(status.submissions, 1);
  const retained = (await journal.read(reservation.requestId))?.dispatch;
  assert.ok(retained);
  assert.deepEqual(succeeded[0]?.value, {
    submissionId: retained.identity.identifiers[0],
    txHash: retained.identity.txHash,
  });
});

test('cancellation during balancing prevents the original from reaching the submitter', async () => {
  const protectedStore = memoryStore();
  const fence = memoryStore();
  const journal = createShieldedWithdrawalJournal(protectedStore, fence);
  const reopened = createShieldedWithdrawalJournal(protectedStore, fence);
  const scope = { ...pins, requestId: reservation.requestId, account };
  assert.equal(await reopened.cancelBeforeDispatch(scope), false);
  assert.equal(await journal.reserve(reservation), true);
  assert.equal(await reopened.cancelBeforeDispatch({ ...scope, account: '11'.repeat(32) }), false);
  assert.equal(await reopened.cancelBeforeDispatch({ ...scope, networkId: 'preview' }), false);
  const { runtime, status } = stagedRuntime(journal);
  const balance = runtime.wallet.balanceAndSign;
  await assert.rejects(
    submitStagedShieldedWithdrawal(reservation.requestId, request, {
      ...runtime,
      wallet: {
        ...runtime.wallet,
        async balanceAndSign(bytes) {
          assert.equal(await reopened.cancelBeforeDispatch(scope), true);
          return balance(bytes);
        },
      },
    }),
    { code: 'MutationUnsettled' },
  );
  assert.equal(status.balances, 1);
  assert.equal(status.submissions, 0);
  assert.equal(await reopened.cancelBeforeDispatch(scope), true);
  assert.equal(await reopened.reserve(reservation), false);
});

test('staging wins over cancellation even if either retained store has an older view', async () => {
  const protectedStore = memoryStore();
  const fence = memoryStore();
  const journal = createShieldedWithdrawalJournal(protectedStore, fence);
  const scope = { ...pins, requestId: reservation.requestId, account };
  assert.equal(await journal.reserve(reservation), true);
  /** @param {string} kind */
  const key = (kind) => mutationDigest({ kind, requestId: scope.requestId }).slice(0, 32);
  const oldRecord = await protectedStore.read(key('shielded-withdrawal'));
  const oldFence = await fence.read(key('shielded-withdrawal-fence'));
  const { runtime, status } = stagedRuntime(journal);
  const submit = runtime.submitter.submit;
  await submitStagedShieldedWithdrawal(reservation.requestId, request, {
    ...runtime,
    submitter: {
      async submit(bytes) {
        assert.equal(await journal.cancelBeforeDispatch(scope), false);
        return submit(bytes);
      },
    },
  });
  assert.equal(status.submissions, 1);
  const staleRecord = createShieldedWithdrawalJournal(
    { ...protectedStore, read: async () => structuredClone(oldRecord) },
    fence,
  );
  assert.equal(await staleRecord.cancelBeforeDispatch(scope), false);
  const staleFence = createShieldedWithdrawalJournal(protectedStore, {
    ...fence,
    read: async () => structuredClone(oldFence),
  });
  assert.equal(await staleFence.cancelBeforeDispatch(scope), false);
  const stagedFence = await fence.read(key('shielded-withdrawal-fence'));
  assert.ok(stagedFence);
  stagedFence.bytes[0] = 4;
  const changedMarker = createShieldedWithdrawalJournal(
    { ...protectedStore, read: async () => structuredClone(oldRecord) },
    { ...fence, read: async () => structuredClone(stagedFence) },
  );
  assert.equal(await changedMarker.cancelBeforeDispatch(scope), false);
});

test('interrupted dispatch admission leaves an inconclusive original without forwarding', async () => {
  const protectedStore = memoryStore();
  const fence = memoryStore();
  const journal = createShieldedWithdrawalJournal(
    {
      ...protectedStore,
      async compareAndSwap(key, expected, next) {
        if (expected === 0) throw new Error('injected crash after dispatch fence');
        return protectedStore.compareAndSwap(key, expected, next);
      },
    },
    fence,
  );
  assert.equal(await journal.reserve(reservation), true);
  const { runtime, status } = stagedRuntime(journal);
  await assert.rejects(submitStagedShieldedWithdrawal(reservation.requestId, request, runtime), {
    code: 'MutationUnsettled',
  });
  assert.equal(status.balances, 1);
  assert.equal(status.submissions, 0);
  const reopened = createShieldedWithdrawalJournal(protectedStore, fence);
  assert.equal(
    await reopened.cancelBeforeDispatch({ ...pins, requestId: reservation.requestId, account }),
    false,
  );
  assert.equal((await reopened.read(reservation.requestId))?.dispatch, undefined);
  await assert.rejects(
    submitStagedShieldedWithdrawal(reservation.requestId, request, {
      ...runtime,
      journal: reopened,
    }),
    { code: 'MutationUnsettled' },
  );
  assert.equal(status.submissions, 0);
});

test('a legacy reserved request can stage but cannot prove cancellation', async () => {
  const protectedStore = memoryStore();
  const fence = memoryStore();
  const scope = { ...pins, requestId: reservation.requestId, account };
  const recordKey = mutationDigest({
    kind: 'shielded-withdrawal',
    requestId: scope.requestId,
  }).slice(0, 32);
  const fenceKey = mutationDigest({
    kind: 'shielded-withdrawal-fence',
    requestId: scope.requestId,
  }).slice(0, 32);
  assert.equal(
    await protectedStore.compareAndSwap(recordKey, undefined, {
      revision: 0,
      bytes: new TextEncoder().encode(JSON.stringify({ version: 1, reservation })),
    }),
    true,
  );
  assert.equal(
    await fence.compareAndSwap(fenceKey, undefined, {
      revision: 0,
      bytes: Uint8Array.of(1),
    }),
    true,
  );
  const journal = createShieldedWithdrawalJournal(protectedStore, fence);
  assert.equal(await journal.cancelBeforeDispatch(scope), false);
  const { runtime, status } = stagedRuntime(journal);
  await submitStagedShieldedWithdrawal(reservation.requestId, request, runtime);
  assert.equal(status.submissions, 1);
  assert.equal(await journal.cancelBeforeDispatch(scope), false);
});

test('missing or changed private change refuses before proving or staging', async () => {
  const journal = createShieldedWithdrawalJournal(memoryStore(), memoryStore());
  assert.equal(await journal.reserve(reservation), true);
  const { runtime, status } = stagedRuntime(journal);
  const valid = privateChange();
  const fakeNonce = new Uint8Array(32);
  fakeNonce[Symbol.iterator] = valid.value.nonce.values.bind(valid.value.nonce);
  const invalid = [
    undefined,
    { ...valid, is_some: false },
    { ...valid, value: { ...valid.value, value: 11n } },
    { ...valid, value: { ...valid.value, nonce: new Uint8Array(32) } },
    { ...valid, value: { ...valid.value, color: new Uint8Array(32) } },
    { ...valid, value: { ...valid.value, nonce: fakeNonce } },
  ];
  for (const result of invalid) {
    await assert.rejects(
      submitStagedShieldedWithdrawal(reservation.requestId, request, {
        ...runtime,
        build: async () => ({ private: { unprovenTx: transaction(), result } }),
      }),
      { code: 'MutationUnsettled' },
    );
  }
  assert.equal(status.proves, 0);
  assert.equal(status.submissions, 0);
  assert.equal((await journal.read(reservation.requestId))?.dispatch, undefined);
});

test('lost acknowledgement retains the original dispatch and refuses replay after reopening', async () => {
  const protectedStore = memoryStore();
  const fence = memoryStore();
  const journal = createShieldedWithdrawalJournal(protectedStore, fence);
  assert.equal(await journal.reserve(reservation), true);
  const { runtime, status } = stagedRuntime(journal);
  const submit = runtime.submitter.submit;
  await assert.rejects(
    submitStagedShieldedWithdrawal(reservation.requestId, request, {
      ...runtime,
      submitter: {
        async submit(bytes) {
          await submit(bytes);
          throw new Error('private wallet diagnostic');
        },
      },
    }),
    (error) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'MutationUnsettled' &&
      !String(error).includes('private wallet diagnostic'),
  );
  const reopened = createShieldedWithdrawalJournal(protectedStore, fence);
  const retained = (await reopened.read(reservation.requestId))?.dispatch;
  assert.ok(retained);
  const recovered = await recoverShieldedWithdrawal(reservation.requestId, {
    journal: reopened,
    deriveChangeCommitment: (owner, coin) =>
      ledger.ZswapOutput.newContractOwned(
        {
          nonce: Buffer.from(coin.nonce).toString('hex'),
          type: Buffer.from(coin.color).toString('hex'),
          value: coin.value,
        },
        undefined,
        owner,
      ).commitment,
    finality: {
      ...pins,
      async readFinalized(identity) {
        assert.deepEqual(identity, retained.identity);
        return {
          dispatch: retained,
          account,
          circuit,
          bindingId,
          blockHash: '77'.repeat(32),
          blockHeight: 23,
          inputNullifier: input.nullifier,
          outputCommitments: [payout.commitment, change.commitment],
          changeOutput: { account, commitment: change.commitment, index: 2n },
        };
      },
    },
  });
  assert.equal(recovered.kind, 'change-found');
  assert.equal(recovered.txHash, retained.identity.txHash);
  assert.equal(recovered.change.value, changeCoin.value);
  await assert.rejects(
    submitStagedShieldedWithdrawal(reservation.requestId, request, {
      ...runtime,
      journal: reopened,
    }),
    { code: 'MutationUnsettled' },
  );
  assert.deepEqual(status, { builds: 1, proves: 1, balances: 1, submissions: 1 });
});

test('cancellation at the durable fence prevents dispatch and keeps the staged original', async () => {
  const journal = createShieldedWithdrawalJournal(memoryStore(), memoryStore());
  assert.equal(await journal.reserve(reservation), true);
  const { runtime, status } = stagedRuntime(journal);
  const controller = new AbortController();
  await assert.rejects(
    submitStagedShieldedWithdrawal(
      reservation.requestId,
      { ...request, signal: controller.signal },
      {
        ...runtime,
        journal: {
          ...journal,
          async stageDispatch(...args) {
            const staged = await journal.stageDispatch(...args);
            controller.abort();
            return staged;
          },
        },
      },
    ),
    { code: 'MutationUnsettled' },
  );
  assert.equal(status.submissions, 0);
  assert.ok((await journal.read(reservation.requestId))?.dispatch);
});

test('refuses a fee-only wallet and catches a wallet substitution before staging', async () => {
  const journal = createShieldedWithdrawalJournal(memoryStore(), memoryStore());
  assert.equal(await journal.reserve(reservation), true);
  const { runtime, status } = stagedRuntime(journal);
  await assert.rejects(
    submitStagedShieldedWithdrawal(reservation.requestId, request, {
      ...runtime,
      wallet: { ...runtime.wallet, supportsShieldedOffers: false },
    }),
    { code: 'MutationUnsettled' },
  );
  assert.equal(status.builds, 0);
  await assert.rejects(
    submitStagedShieldedWithdrawal(reservation.requestId, request, {
      ...runtime,
      wallet: {
        supportsShieldedOffers: true,
        async balanceAndSign() {
          return (await transaction().prove(fixtureProving, ledger.CostModel.initialCostModel()))
            .bind()
            .serialize();
        },
      },
    }),
    { code: 'MutationUnsettled' },
  );
  assert.equal(status.submissions, 0);
  assert.equal((await journal.read(reservation.requestId))?.dispatch, undefined);
});

test('refuses a substituted payout note with the same coin and call commitments', async () => {
  const journal = createShieldedWithdrawalJournal(memoryStore(), memoryStore());
  assert.equal(await journal.reserve(reservation), true);
  const { runtime, status } = stagedRuntime(journal);
  const randomness = ledger.communicationCommitmentRandomness();
  const original = transaction({ randomness });
  const other = ledger.ZswapOutput.new(
    { ...coin, nonce: '33'.repeat(32), value: 5n },
    undefined,
    payoutRecipient,
    ledger.sampleEncryptionPublicKey(),
  );
  assert.equal(other.commitment, payout.commitment);
  assert.notDeepEqual(other.serialize(), payout.serialize());
  const substituted = transaction({ randomness, payoutOutput: other });
  assert.equal(
    verifyShieldedWithdrawalCall(substituted, reservation),
    verifyShieldedWithdrawalCall(original, reservation),
  );
  const proved = await substituted.prove(fixtureProving, ledger.CostModel.initialCostModel());
  const walletBytes = proved.bind().serialize();
  const build = async () => ({ private: { unprovenTx: original, result: privateChange() } });
  await assert.rejects(
    submitStagedShieldedWithdrawal(reservation.requestId, request, {
      ...runtime,
      build,
      prover: {
        async proveTx() {
          return { tx: proved.serialize(), provenance: 'local' };
        },
      },
    }),
    { code: 'MutationUnsettled' },
  );
  assert.equal(status.balances, 0);
  await assert.rejects(
    submitStagedShieldedWithdrawal(reservation.requestId, request, {
      ...runtime,
      build,
      wallet: {
        supportsShieldedOffers: true,
        async balanceAndSign() {
          return walletBytes;
        },
      },
    }),
    { code: 'MutationUnsettled' },
  );
  assert.equal(status.submissions, 0);
  assert.equal((await journal.read(reservation.requestId))?.dispatch, undefined);
});

test('refuses an unproven transaction built on another network before proving', async () => {
  const journal = createShieldedWithdrawalJournal(memoryStore(), memoryStore());
  assert.equal(await journal.reserve(reservation), true);
  const { runtime, status } = stagedRuntime(journal);
  await assert.rejects(
    submitStagedShieldedWithdrawal(reservation.requestId, request, {
      ...runtime,
      async build() {
        return {
          private: { unprovenTx: transaction({ network: 'other' }), result: privateChange() },
        };
      },
    }),
    { code: 'MutationUnsettled' },
  );
  assert.equal(status.proves, 0);
  assert.equal(status.submissions, 0);
  assert.equal((await journal.read(reservation.requestId))?.dispatch, undefined);
});

test('refuses another network returned by the prover or wallet before staging', async () => {
  const journal = createShieldedWithdrawalJournal(memoryStore(), memoryStore());
  assert.equal(await journal.reserve(reservation), true);
  const { runtime, status } = stagedRuntime(journal);
  const randomness = ledger.communicationCommitmentRandomness();
  const original = transaction({ randomness });
  const other = transaction({ randomness, network: 'other' });
  const proved = await other.prove(fixtureProving, ledger.CostModel.initialCostModel());
  const build = async () => ({ private: { unprovenTx: original, result: privateChange() } });
  await assert.rejects(
    submitStagedShieldedWithdrawal(reservation.requestId, request, {
      ...runtime,
      build,
      prover: {
        async proveTx() {
          return { tx: proved.serialize(), provenance: 'local' };
        },
      },
    }),
    { code: 'MutationUnsettled' },
  );
  assert.equal(status.balances, 0);
  await assert.rejects(
    submitStagedShieldedWithdrawal(reservation.requestId, request, {
      ...runtime,
      build,
      wallet: {
        supportsShieldedOffers: true,
        async balanceAndSign() {
          return proved.bind().serialize();
        },
      },
    }),
    { code: 'MutationUnsettled' },
  );
  assert.equal(status.submissions, 0);
  assert.equal((await journal.read(reservation.requestId))?.dispatch, undefined);
});
