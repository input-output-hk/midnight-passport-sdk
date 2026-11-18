import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import * as ledgerV9 from '@midnightntwrk/ledger-v9';
import {
  ChargedState,
  ContractOperation,
  ContractState,
  createConstructorContext,
  StateMap,
  StateValue,
} from '@midnight-ntwrk/compact-runtime';
import {
  ContractState as LedgerContractState,
  LedgerParameters,
  PreTranscript,
  QueryContext,
  partitionTranscripts,
} from '@midnightntwrk/ledger-v9';
import { createMidnamesIndexer, createMidnamesLedgerReads } from '../src/midnames/ledger-reader.js';
import { MIDNAMES_REGISTRY_VERIFIERS } from '../src/midnames/registry-pins.js';

const profile = { networkId: 'undeployed', namespace: 'night', registryAddress: '11'.repeat(32) };
const target = '33'.repeat(32);
const claimSecret = new Uint8Array(32).fill(9);
const coin = '00'.repeat(32);
const payment = {
  cost_short: 1n,
  cost_med: 1n,
  cost_long: 1n,
  coin_color: new Uint8Array(32),
  buy_enabled: true,
};
const owner = { bytes: new Uint8Array(32).fill(4) };

function fields(values: [string, string][] = []) {
  return Array.from({ length: 10 }, (_, index) => {
    const value = values[index];
    return value
      ? { is_some: true, value }
      : { is_some: false, value: ['', ''] as [string, string] };
  });
}

async function registryFixture() {
  // Fixture construction needs the actual reader's generated state. The
  // package's root export also loads an older write artifact, so avoid it.
  const reader = new URL('./reader/contract/index.js', import.meta.resolve('@midnames/sdk/core'));
  const { AddressType, Contract, ledger }: typeof import('@midnames/sdk') = await import(
    reader.href
  );
  const contract = new Contract({ domainSecretKey: () => [{}, new Uint8Array(32).fill(3)] });
  const claimant = new Contract({ domainSecretKey: () => [{}, claimSecret] });
  const bytes = new Uint8Array(32).fill(0x33);
  const start = await contract.initialState(
    createConstructorContext({}, coin),
    'night',
    bytes,
    AddressType.ContractAddr,
    { is_some: false, value: '' },
    payment,
    owner,
    fields([]),
    { is_some: false, value: 0n },
    true,
  );
  const root = ledger(start.currentContractState.data).ROOT_ZONE_ID;
  const key = new Uint8Array(32).fill(255);
  key.set(new TextEncoder().encode('alice'));
  const runtimePath = createRequire(reader).resolve('@midnight-ntwrk/compact-runtime');
  const {
    createCircuitContext,
  }: {
    createCircuitContext(options: {
      circuitId: 'create_domain' | 'transfer_domain';
      contractAddress: string;
      coinPublicKeyOrZswapState: string;
      contractState: typeof start.currentContractState.data;
      privateState: object;
      time: number;
    }): Parameters<typeof contract.circuits.create_domain>[0];
  } = await import(pathToFileURL(runtimePath).href);
  const context = createCircuitContext({
    circuitId: 'create_domain',
    contractAddress: profile.registryAddress,
    coinPublicKeyOrZswapState: coin,
    contractState: start.currentContractState.data,
    privateState: {},
    time: 0,
  });
  const created = await claimant.circuits.create_domain(
    context,
    owner,
    key,
    5n,
    root,
    bytes,
    AddressType.ContractAddr,
    { is_some: true, value: 'profile' },
    payment,
    fields([['profile', 'different-target']]),
  );
  const trace = created.context.callProofDataTrace[0];
  assert.ok(trace);
  const state = ContractState.deserialize(start.currentContractState.serialize());
  // Transfer the simulated ledger data through the runtime boundary as serialized state.
  const createdState = start.currentContractState;
  createdState.data = created.context.callContext.currentQueryContext.state;
  const result = ContractState.deserialize(createdState.serialize());
  for (const name of Object.keys(MIDNAMES_REGISTRY_VERIFIERS)) {
    const verifier = new URL(
      `./managed/keys/${name}.verifier`,
      import.meta.resolve('@midnames/sdk'),
    );
    const operation = new ContractOperation();
    operation.verifierKey = readFileSync(verifier);
    result.setOperation(name, operation);
  }
  const transferState = ContractState.deserialize(result.serialize());
  const transferContext = createCircuitContext({
    circuitId: 'transfer_domain',
    contractAddress: profile.registryAddress,
    coinPublicKeyOrZswapState: coin,
    contractState: transferState.data,
    privateState: {},
    time: 0,
  });
  const transferred = await claimant.circuits.transfer_domain(
    transferContext,
    key,
    root,
    new Uint8Array(32).fill(7),
    owner,
  );
  const transferTrace = transferred.context.callProofDataTrace[0];
  assert.ok(transferTrace);
  return { result, state, trace, transferState, transferTrace };
}

function assertGasBoundary(
  state: ContractState,
  trace: Awaited<ReturnType<typeof registryFixture>>['trace'],
) {
  const initial = LedgerContractState.deserialize(state.serialize());
  const params = LedgerParameters.initialParameters();
  const model = params.transactionCostModel.runtimeCostModel;
  const context = () => new QueryContext(initial.data, profile.registryAddress);
  const [partition] = partitionTranscripts(
    [new PreTranscript(context(), trace.publicTranscript)],
    params,
  );
  const transcript = partition?.[0];
  assert.ok(transcript);
  const gather = transcript.program.map((operation) =>
    typeof operation === 'object' && 'popeq' in operation
      ? { popeq: { ...operation.popeq, result: null } }
      : operation,
  );
  const measured = context().query(gather, model).gasCost;
  assert.ok(measured.bytesDeleted > 0n);
  assert.throws(
    () =>
      context().runTranscript(
        { ...transcript, gas: { ...transcript.gas, bytesDeleted: measured.bytesDeleted + 1n } },
        model,
      ),
    /ran out of gas budget/,
  );
  assert.doesNotThrow(() =>
    context().runTranscript({ ...transcript, gas: { ...transcript.gas, bytesDeleted: 0n } }, model),
  );
}

test('create_domain replay refuses an overclaimed deletion credit', async () => {
  const { state, trace } = await registryFixture();
  assertGasBoundary(state, trace);
});

test('transfer_domain replay refuses an overclaimed deletion credit', async () => {
  const { transferState, transferTrace } = await registryFixture();
  assertGasBoundary(transferState, transferTrace);
});

test('standalone naming calls are rebuilt before proof without deletion credit', async () => {
  const { state, trace, transferState, transferTrace } = await registryFixture();
  const { withoutDeletionCredit } = (await import(
    new URL('../../../examples/midnames-local/deletion-credit.mjs', import.meta.url).href
  )) as {
    withoutDeletionCredit: (
      result: unknown,
      state: unknown,
      networkId: string,
      ledger: typeof ledgerV9,
      types: unknown,
      address: string,
    ) => ledgerV9.UnprovenTransaction;
  };
  for (const [circuit, startingState, proof] of [
    ['create_domain', state, trace],
    ['transfer_domain', transferState, transferTrace],
  ] as const) {
    const ledgerState = LedgerContractState.deserialize(startingState.serialize());
    const operation = ledgerState.operation(circuit);
    assert.ok(operation);
    const [partition] = partitionTranscripts(
      [
        new PreTranscript(
          new QueryContext(ledgerState.data, profile.registryAddress),
          proof.publicTranscript,
        ),
      ],
      LedgerParameters.initialParameters(),
    );
    const transcript = partition?.[0];
    assert.ok(transcript);
    for (const segment of ['guaranteed', 'fallible'] as const) {
      const pair =
        segment === 'guaranteed'
          ? ([transcript, undefined] as const)
          : ([undefined, transcript] as const);
      const originalCall = new ledgerV9.ContractCallPrototype(
        profile.registryAddress,
        circuit,
        operation,
        pair[0],
        pair[1],
        proof.privateTranscriptOutputs,
        proof.input,
        proof.output,
        ledgerV9.communicationCommitmentRandomness(),
        'fixture',
      );
      const original = ledgerV9.Transaction.fromPartsRandomized(
        'undeployed',
        undefined,
        undefined,
        ledgerV9.Intent.new(new Date(Date.now() + 3_600_000)).addCall(originalCall),
      );
      const adjusted = withoutDeletionCredit(
        {
          private: { unprovenTx: original },
          calls: [
            {
              contractAddress: profile.registryAddress,
              circuitId: circuit,
              public: { partitionedTranscript: pair },
              private: {
                privateTranscriptOutputs: proof.privateTranscriptOutputs,
                input: proof.input,
                output: proof.output,
              },
            },
          ],
        },
        startingState,
        'undeployed',
        ledgerV9,
        { hashVerifierKey: () => 'fixture', encodeContractKeyLocation: () => 'fixture' },
        profile.registryAddress,
      );
      const decoded = ledgerV9.Transaction.deserialize(
        'signature',
        'pre-proof',
        'pre-binding',
        adjusted.serialize(),
      );
      const [call] = [...(decoded.intents?.values() ?? [])].flatMap((intent) => intent.actions);
      assert.ok(call instanceof ledgerV9.ContractCall);
      const adjustedTranscript =
        segment === 'guaranteed' ? call.guaranteedTranscript : call.fallibleTranscript;
      assert.ok(adjustedTranscript);
      assert.equal(adjustedTranscript.gas.bytesDeleted, 0n);
      assert.deepEqual(adjustedTranscript.program, transcript.program);
      assert.deepEqual(adjustedTranscript.effects, transcript.effects);
    }
  }
});

test('installed Midnames v2.1 reads its generated registry over the Ledger 9 indexer wire format', async (t) => {
  const { result, state } = await registryFixture();
  let registryState = Buffer.from(result.serialize()).toString('hex');
  const ledgerParameters = Buffer.from(LedgerParameters.initialParameters().serialize()).toString(
    'hex',
  );
  let queryCount = 0;
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
    });
    request.on('end', () => {
      queryCount++;
      const { variables } = JSON.parse(body);
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          data: {
            block: { protocolVersion: 2001000, ledgerParameters },
            contract:
              variables.address === profile.registryAddress ? { state: registryState } : null,
          },
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const indexer = createMidnamesIndexer(
    'undeployed',
    `http://127.0.0.1:${address.port}/api/v4/graphql`,
    `ws://127.0.0.1:${address.port}/api/v4/graphql/ws`,
  );
  const reads = createMidnamesLedgerReads(indexer, 'undeployed', 'acc-s3r1.1');
  const standalone = createMidnamesLedgerReads(
    indexer,
    'undeployed',
    'acc-s3r1.1',
    'standalone-0.35',
  );
  assert.deepEqual(await reads.readTarget('alice.night', profile), {
    kind: 'contract',
    address: target,
  });
  assert.equal(queryCount, 1);
  const ownerTag = Buffer.alloc(32);
  ownerTag.write('midnight.domains');
  const expectedOwner = createHash('sha256').update(ownerTag).update(claimSecret).digest('hex');
  assert.deepEqual(await reads.readClaim('alice.night', profile), {
    ownerCommitment: expectedOwner,
    target: { kind: 'contract', address: target },
  });
  assert.equal(queryCount, 2);
  await assert.rejects(standalone.readTarget('alice.night', profile), { code: 'InvalidRecord' });
  assert.equal(await reads.readTarget('missing.night', profile), undefined);
  assert.equal(await reads.readClaim('missing.night', profile), undefined);
  assert.equal(await reads.hasDomain('alice.night', profile), true);
  assert.equal(await reads.hasDomain('missing.night', profile), false);
  await assert.rejects(standalone.hasDomain('missing.night', profile), { code: 'InvalidRecord' });
  await assert.rejects(reads.hasDomain('missing.night', { ...profile, networkId: 'preview' }), {
    code: 'InvalidQuery',
  });
  assert.equal(await reads.isSupportedAccount(target, 'undeployed'), false);
  assert.equal(await reads.readSupportedNightBalance(target, 'undeployed'), undefined);
  assert.equal(await reads.readSupportedNightBalance(target, 'other-network'), undefined);
  // Keep the name-to-ID index but remove its record map.
  const malformed = ContractState.deserialize(result.serialize());
  const slots = malformed.data.state.asArray();
  assert.ok(slots && slots[4]?.asMap());
  slots[4] = StateValue.newMap(new StateMap());
  malformed.data = new ChargedState(
    slots.reduce((value, slot) => value.arrayPush(slot), StateValue.newArray()),
  );
  registryState = Buffer.from(malformed.serialize()).toString('hex');
  await assert.rejects(reads.hasDomain('alice.night', profile), { code: 'InvalidRecord' });
  registryState = Buffer.from(state.serialize()).toString('hex');
  await assert.rejects(reads.readTarget('alice.night', profile), { code: 'InvalidRecord' });
  await assert.rejects(reads.readClaim('alice.night', profile), { code: 'InvalidRecord' });
  await assert.rejects(reads.hasDomain('missing.night', profile), { code: 'InvalidRecord' });
});
