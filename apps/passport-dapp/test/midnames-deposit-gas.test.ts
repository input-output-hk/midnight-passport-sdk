import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCircuitContext, createConstructorContext } from '@midnight-ntwrk/compact-runtime';
import * as ledger from '@midnightntwrk/ledger-v9';
import * as acc from '#acc';
import { measuredAccNightDeletionCredit } from '../../../packages/adapter-midnight-js/src/night-deposit.js';

const address = '11'.repeat(32);
const zero = '00'.repeat(32);

test('generated ACC deposit replay refuses excess deletion credit before proof', async () => {
  const contract = new acc.Contract({
    held_coin: () => {
      throw new Error('Deposit does not need an owner-held coin.');
    },
  });
  const initial = await contract.initialState(
    createConstructorContext({}, zero),
    new Uint8Array(32).fill(1),
    new Uint8Array(32).fill(2),
    acc.pureCircuits.compute_public_point_with_jubjub(1n),
    new Uint8Array(64),
    60n,
  );
  const context = createCircuitContext({
    circuitId: 'deposit_shielded',
    contractAddress: address,
    coinPublicKeyOrZswapState: zero,
    contractState: initial.currentContractState.data,
    privateState: {},
    time: 0,
  });
  const execution = await contract.circuits.deposit_shielded(
    context,
    { nonce: new Uint8Array(32).fill(3), color: new Uint8Array(32).fill(4), value: 10n },
    new Uint8Array(192).fill(5),
  );
  const proof = execution.context.callProofDataTrace[0];
  assert.ok(proof);
  const state = ledger.ContractState.deserialize(initial.currentContractState.serialize());
  const operation = state.operation('deposit_shielded');
  assert.ok(operation);
  const parameters = ledger.LedgerParameters.initialParameters();
  const model = parameters.transactionCostModel.runtimeCostModel;
  const query = () => new ledger.QueryContext(state.data, address);
  const [partition] = ledger.partitionTranscripts(
    [new ledger.PreTranscript(query(), proof.publicTranscript)],
    parameters,
  );
  const transcript = partition?.[0];
  assert.ok(transcript);
  const gather = transcript.program.map((part) =>
    typeof part === 'object' && 'popeq' in part ? { popeq: { ...part.popeq, result: null } } : part,
  );
  const measured = query().query(gather, model).gasCost;
  const overclaimed = {
    ...transcript,
    gas: { ...transcript.gas, bytesDeleted: measured.bytesDeleted + 1n },
  };
  assert.throws(() => query().runTranscript(overclaimed, model), /ran out of gas budget/);
  assert.doesNotThrow(() =>
    query().runTranscript({ ...overclaimed, gas: { ...overclaimed.gas, bytesDeleted: 0n } }, model),
  );

  const { withoutDeletionCredit } = (await import(
    new URL('../../../examples/midnames-local/deletion-credit.mjs', import.meta.url).href
  )) as {
    withoutDeletionCredit: (
      result: unknown,
      state: unknown,
      networkId: string,
      ledgerModule: typeof ledger,
      types: unknown,
      contractAddress: string,
    ) => ledger.UnprovenTransaction;
  };
  for (const segment of ['guaranteed', 'fallible'] as const) {
    const pair =
      segment === 'guaranteed'
        ? ([overclaimed, undefined] as const)
        : ([undefined, overclaimed] as const);
    const originalCall = new ledger.ContractCallPrototype(
      address,
      'deposit_shielded',
      operation,
      pair[0],
      pair[1],
      proof.privateTranscriptOutputs,
      proof.input,
      proof.output,
      ledger.communicationCommitmentRandomness(),
      'fixture',
    );
    const original = ledger.Transaction.fromPartsRandomized(
      'undeployed',
      undefined,
      undefined,
      ledger.Intent.new(new Date(Date.now() + 3_600_000)).addCall(originalCall),
    );
    const adjusted = withoutDeletionCredit(
      {
        private: { unprovenTx: original },
        calls: [
          {
            contractAddress: address,
            circuitId: 'deposit_shielded',
            public: { partitionedTranscript: pair },
            private: {
              privateTranscriptOutputs: proof.privateTranscriptOutputs,
              input: proof.input,
              output: proof.output,
            },
          },
        ],
      },
      state,
      'undeployed',
      ledger,
      { hashVerifierKey: () => 'fixture', encodeContractKeyLocation: () => 'fixture' },
      address,
    );
    const decoded = ledger.Transaction.deserialize(
      'signature',
      'pre-proof',
      'pre-binding',
      adjusted.serialize(),
    );
    const [call] = [...(decoded.intents?.values() ?? [])].flatMap((intent) => intent.actions);
    assert.ok(call instanceof ledger.ContractCall);
    const safe = segment === 'guaranteed' ? call.guaranteedTranscript : call.fallibleTranscript;
    assert.ok(safe);
    assert.equal(safe.gas.bytesDeleted, 0n);
    assert.deepEqual(safe.program, overclaimed.program);
    assert.deepEqual(safe.effects, overclaimed.effects);
    assert.doesNotThrow(() => query().runTranscript(safe, model));
  }
});

test('ACC NIGHT funding keeps its exact call and earned deletion credit', async () => {
  const contract = new acc.Contract({
    held_coin: () => {
      throw new Error('NIGHT funding does not need an owner-held coin.');
    },
  });
  const initial = await contract.initialState(
    createConstructorContext({}, zero),
    new Uint8Array(32).fill(1),
    new Uint8Array(32).fill(2),
    acc.pureCircuits.compute_public_point_with_jubjub(1n),
    new Uint8Array(64),
    60n,
  );
  const context = createCircuitContext({
    circuitId: 'deposit_unshielded',
    contractAddress: address,
    coinPublicKeyOrZswapState: zero,
    contractState: initial.currentContractState.data,
    privateState: {},
    time: 0,
  });
  const execution = await contract.circuits.deposit_unshielded(context, new Uint8Array(32), 10n);
  const proof = execution.context.callProofDataTrace[0];
  assert.ok(proof);
  const state = ledger.ContractState.deserialize(initial.currentContractState.serialize());
  const operation = state.operation('deposit_unshielded');
  assert.ok(operation);
  const parameters = ledger.LedgerParameters.initialParameters();
  const model = parameters.transactionCostModel.runtimeCostModel;
  const query = () => new ledger.QueryContext(state.data, address);
  const [partition] = ledger.partitionTranscripts(
    [new ledger.PreTranscript(query(), proof.publicTranscript)],
    parameters,
  );
  const transcript = partition?.[0];
  assert.ok(transcript);
  const gather = transcript.program.map((part) =>
    typeof part === 'object' && 'popeq' in part ? { popeq: { ...part.popeq, result: null } } : part,
  );
  const measured = query().query(gather, model).gasCost;
  const overclaimed = {
    ...transcript,
    gas: { ...transcript.gas, bytesDeleted: measured.bytesDeleted + 1n },
  };
  assert.throws(() => query().runTranscript(overclaimed, model), /ran out of gas budget/);
  assert.equal(
    measuredAccNightDeletionCredit(overclaimed, state, parameters, address),
    measured.bytesDeleted,
  );
  assert.equal(
    measuredAccNightDeletionCredit(
      { ...overclaimed, gas: { ...overclaimed.gas, bytesDeleted: measured.bytesDeleted - 1n } },
      state,
      parameters,
      address,
    ),
    measured.bytesDeleted,
  );
  const originalCall = new ledger.ContractCallPrototype(
    address,
    'deposit_unshielded',
    operation,
    overclaimed,
    undefined,
    proof.privateTranscriptOutputs,
    proof.input,
    proof.output,
    ledger.communicationCommitmentRandomness(),
    'fixture',
  );
  const original = ledger.Transaction.fromPartsRandomized(
    'undeployed',
    undefined,
    undefined,
    ledger.Intent.new(new Date(Date.now() + 3_600_000)).addCall(originalCall),
  );
  const { withMeasuredDeletionCredit } = (await import(
    new URL('../../../examples/midnames-local/deletion-credit.mjs', import.meta.url).href
  )) as {
    withMeasuredDeletionCredit: (
      result: unknown,
      state: unknown,
      parameters: ledger.LedgerParameters,
      networkId: string,
      ledgerModule: typeof ledger,
      types: unknown,
      contractAddress: string,
    ) => ledger.UnprovenTransaction;
  };
  const result = {
    private: { unprovenTx: original },
    calls: [
      {
        contractAddress: address,
        circuitId: 'deposit_unshielded',
        public: { partitionedTranscript: [overclaimed, undefined] },
        private: {
          privateTranscriptOutputs: proof.privateTranscriptOutputs,
          input: proof.input,
          output: proof.output,
        },
      },
    ],
  };
  const adjust = (input: unknown) =>
    withMeasuredDeletionCredit(
      input,
      state,
      parameters,
      'undeployed',
      ledger,
      { hashVerifierKey: () => 'fixture', encodeContractKeyLocation: () => 'fixture' },
      address,
    );
  assert.throws(
    () => adjust({ ...result, calls: [{ ...result.calls[0], circuitId: 'withdraw_unshielded' }] }),
    /one guaranteed ACC NIGHT deposit/,
  );
  assert.throws(
    () =>
      adjust({
        ...result,
        calls: [
          { ...result.calls[0], public: { partitionedTranscript: [undefined, overclaimed] } },
        ],
      }),
    /one guaranteed ACC NIGHT deposit/,
  );
  const adjusted = adjust(result);
  const decoded = ledger.Transaction.deserialize(
    'signature',
    'pre-proof',
    'pre-binding',
    adjusted.serialize(),
  );
  const [call] = [...(decoded.intents?.values() ?? [])].flatMap((intent) => intent.actions);
  assert.ok(call instanceof ledger.ContractCall);
  const safe = call.guaranteedTranscript;
  assert.ok(safe);
  assert.equal(safe.gas.bytesDeleted, measured.bytesDeleted);
  assert.deepEqual(safe.program, overclaimed.program);
  assert.deepEqual(safe.effects, overclaimed.effects);
  assert.doesNotThrow(() => query().runTranscript(safe, model));
});
