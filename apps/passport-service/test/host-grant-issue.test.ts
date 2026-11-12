import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { gunzipSync } from 'node:zlib';
import * as Ledger from '@midnightntwrk/ledger-v9';
import { grantIssueHostRequestId } from '@input-output-hk/mn-passport-protocol';
import {
  createServer,
  createHostMutationExecutor,
  encryptedHostMutationStore,
  hostMutationRoute,
  type HostMutationIdentity,
} from '@input-output-hk/mn-passport-service';
import {
  createDeadlineFencedGrantIssueChain,
  createMidnightChain,
} from '../../../packages/adapter-midnight-js/dist/index.js';
import * as binding from '../../../packages/contract/generated/acc-s3r1.1/index.js';
import { remoteHostMutationPorts } from '../../../packages/adapter-service/dist/index.js';
import { createReferenceHostDriver } from '../src/host-driver.ts';
import { balanceHostGrantIssue, readHostGrantIssueRequest } from '../src/host-grant-issue.ts';
import type { ReferenceHostRuntime } from '../src/reference-runtime.ts';

const address = 'ab'.repeat(32);
const circuit = 'issue_grant_with_jubjub';
const requestId = '55473acc-cddf-4e85-a197-341e0a0d4569';
const intentSha256 = 'bc'.repeat(32);
const token = '81'.repeat(32);
const pins = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  scheme: 'jubjub-schnorr' as const,
};
const { files, manifest } = JSON.parse(
  gunzipSync(
    await readFile(
      new URL('../../../packages/contract/resources/acc-s3r1.1.zkir.json.gz', import.meta.url),
    ),
  ).toString(),
) as { files: Record<string, string>; manifest: string };
const resource = (name: string) => Buffer.from(files[name] ?? '', 'base64');
const proving = {
  check: async () => [],
  // Versioned empty proof is a serialization fixture and cannot prove the circuit.
  prove: async () => new Ledger.Proof('0100').serialize(),
  lookupKey: async () => ({
    proverKey: new Uint8Array(),
    verifierKey: resource('keys/issue_grant_with_jubjub.verifier'),
    ir: resource('zkir/issue_grant_with_jubjub.bzkir'),
  }),
};
const unused = (): never => {
  throw new Error('Unexpected fixture capability');
};
const identity: HostMutationIdentity = {
  kind: 'call',
  pins,
  requestId: grantIssueHostRequestId(requestId)!,
  intentSha256,
};

function unprovenCall(
  name = circuit,
  random = Ledger.communicationCommitmentRandomness(),
  paysValue = false,
  ttl = new Date(Date.now() + 60_000),
  transcript?: Ledger.Transcript<Ledger.AlignedValue>,
) {
  const empty = { value: [], alignment: [] };
  const call = new Ledger.ContractCallPrototype(
    address,
    name,
    new Ledger.ContractOperation(),
    transcript,
    undefined,
    [],
    empty,
    empty,
    random,
    'fixture',
  );
  const intent = Ledger.Intent.new(ttl).addCall(call);
  if (paysValue)
    intent.guaranteedUnshieldedOffer = Ledger.UnshieldedOffer.new(
      [],
      [{ value: 5n, owner: '11'.repeat(32), type: '22'.repeat(32) }],
      [],
    );
  return Ledger.Transaction.fromParts(pins.networkId, undefined, undefined, intent);
}

function provedCall(...args: Parameters<typeof unprovenCall>) {
  return unprovenCall(...args).prove(proving, Ledger.CostModel.initialCostModel());
}

function pinnedState() {
  const state = new Ledger.ContractState();
  for (const [name, encoded] of Object.entries(files)) {
    if (!name.startsWith('keys/') || !name.endsWith('.verifier')) continue;
    const operation = new Ledger.ContractOperation();
    operation.verifierKey = Buffer.from(encoded, 'base64');
    state.setOperation(name.slice(5, -9), operation);
  }
  return state;
}

function runtime(state: Ledger.ContractState): ReferenceHostRuntime {
  return {
    ledger: Ledger,
    allowGrantIssue: true,
    versionOfRecord: () => 'v9',
    contracts: { createUnprovenDeployTx: unused },
    waves: { allCircuits: unused, planWaves: unused },
    signer: { JubjubDevice: { generate: unused } },
    setup: { compiledAccountContract: unused },
    witnesses: { emptyCoinStore: unused },
    providers: {
      zkConfigProvider: { getVerifierKey: unused },
      publicDataProvider: { queryContractState: async () => state },
      walletProvider: {
        balanceTx: unused,
        getCoinPublicKey: unused,
        getEncryptionPublicKey: unused,
      },
      midnightProvider: { submitTx: unused },
    },
    proving,
    networkId: pins.networkId,
    indexerUrl: 'http://unused',
    allowedAccount: (target) => target === address,
    deploymentCompleted: unused,
  };
}

test('grant handoff accepts metered noops with the pinned verifier and rejects changed operations or expiry', async (t) => {
  const now = Date.now();
  const ttl = new Date(now + 3_600_000);
  const context = new Ledger.QueryContext(
    new Ledger.ChargedState(Ledger.StateValue.newNull()),
    address,
  );
  const transcript = {
    gas: context.query([], Ledger.CostModel.initialCostModel()).gasCost,
    effects: context.effects,
    program: [{ push: { storage: false, value: { tag: 'null' as const } } }, 'pop' as const],
  };
  const commitment = Ledger.communicationCommitmentRandomness();
  const original = unprovenCall(circuit, commitment, false, ttl, transcript);
  const prove = (tx: Ledger.UnprovenTransaction) =>
    tx.prove(
      { ...proving, check: async () => [3n, undefined, 7n, undefined, 1n] },
      Ledger.CostModel.initialCostModel(),
    );
  const proved = await prove(original);
  assert.notDeepEqual(original.eraseProofs().serialize(), proved.eraseProofs().serialize());
  let returned = proved;
  let dispatches = 0;
  let manifestReads = 0;
  let verifierReads = 0;
  t.mock.method(globalThis, 'fetch', async function (this: unknown, url: string) {
    assert.equal(this, globalThis, 'Fetch requires its global receiver in browsers');
    switch (new URL(url).pathname) {
      case '/v1/zk/acc-s3r1.1/compiler/contract-manifest.json':
        manifestReads++;
        return new Response(manifest);
      case '/v1/zk/acc-s3r1.1/keys/issue_grant_with_jubjub.verifier':
        verifierReads++;
        return new Response(new Uint8Array(resource('keys/issue_grant_with_jubjub.verifier')));
      default:
        return unused();
    }
  });
  const chain = issueChain(
    original,
    {
      async proveTx(bytes) {
        assert.deepEqual(bytes, original.serialize());
        return { tx: returned.serialize(), provenance: 'remote' };
      },
    },
    {
      async execute(bytes, request) {
        dispatches++;
        assert.deepEqual(bytes, proved.serialize());
        assert.equal(request.requestId, requestId);
        assert.equal(request.intentSha256, intentSha256);
        return { txHash: 'cd'.repeat(32), submissionId: 'original' };
      },
    },
  );
  const request = { address, circuit, args: [], mutation: { requestId, intentSha256 } };
  assert.deepEqual(await chain.call(request), { txHash: 'cd'.repeat(32) });
  assert.deepEqual([dispatches, manifestReads, verifierReads], [1, 1, 1]);
  const changed = unprovenCall(circuit, commitment, false, ttl, {
    ...transcript,
    program: [transcript.program[0]!, 'new'],
  });
  returned = await prove(changed);
  await assert.rejects(chain.call(request), { code: 'MutationUnsettled' });
  const [segment, intent] = [...proved.intents!][0]!;
  intent.ttl = new Date(now + 3_660_000);
  proved.intents = new Map([[segment, intent]]);
  returned = proved;
  await assert.rejects(chain.call(request), { code: 'MutationUnsettled' });
  assert.equal(dispatches, 1);
});

function dustFeeIntent(now: Date, ttl: Date) {
  const secret = Ledger.DustSecretKey.fromBigint(11n);
  try {
    const owner = secret.publicKey;
    const backingNight = '22'.repeat(32);
    const coin = {
      initialValue: 1_000_000_000n,
      owner,
      nonce: 1n,
      seq: 0,
      ctime: new Date(now.getTime() - 60_000),
      backingNight,
      mtIndex: 0n,
    };
    const generation = { value: 10_000_000_000n, owner, nonce: backingNight, dtime: undefined };
    const wallet = new Ledger.DustLocalState(Ledger.LedgerParameters.initialParameters().dust)
      .insertGenerationInfo(0n, generation, backingNight)
      .insertCommitment(0n, coin, true)
      .addUtxo(Ledger.dustNullifier(coin, secret), coin);
    const [, spend] = wallet.spend(secret, coin, 100n, now);
    const fee = Ledger.Intent.new(ttl);
    fee.dustActions = new Ledger.DustActions('signature', 'pre-proof', now, [spend], []);
    return fee;
  } finally {
    secret.clear();
  }
}

test('grant sponsor retains the owner expiry and rejects an overlong DUST fee intent', async (t) => {
  const now = new Date(Math.floor(Date.now() / 1000) * 1000);
  t.mock.timers.enable({ apis: ['Date'], now: now.getTime() });
  const ownerExpiry = new Date(now.getTime() + 3_600_000);
  const proved = await provedCall(circuit, undefined, false, ownerExpiry);
  const [ownerSegment] = [...proved.intents!.keys()];
  const feeSegment = ownerSegment === 1 ? 2 : 1;
  const balance = async (ttl: Date) => {
    const fee = Ledger.Transaction.fromParts(pins.networkId).addIntent(
      { tag: 'specific', value: feeSegment },
      dustFeeIntent(now, ttl),
    );
    return proved
      .bind()
      .merge((await fee.prove(proving, Ledger.CostModel.initialCostModel())).bind());
  };
  const feeExpiry = new Date(now.getTime() + 45_000);
  let result = await balance(feeExpiry);
  const r = runtime(pinnedState());
  const request = readHostGrantIssueRequest({
    kind: 'grant-issue-v1',
    address,
    circuit,
    requestId,
    tx: Buffer.from(proved.serialize()).toString('hex'),
  });
  const bound = {
    ...r,
    providers: {
      ...r.providers,
      walletProvider: {
        ...r.providers.walletProvider,
        async balanceTx(_transaction: unknown, ttl?: Date) {
          assert.deepEqual(ttl, feeExpiry);
          return { version: 'v9' as const, tx: result };
        },
      },
    },
  };
  const original = await balanceHostGrantIssue(bound, request);
  const exact = Ledger.Transaction.deserialize(
    'signature',
    'proof',
    'binding',
    Buffer.from(original.tx, 'hex'),
  );
  assert.deepEqual(exact.intents?.get(ownerSegment!)?.ttl, ownerExpiry);
  assert.deepEqual(exact.intents?.get(feeSegment)?.ttl, feeExpiry);
  assert.equal(exact.intents?.get(feeSegment)?.dustActions?.spends.length, 1);
  result = await balance(new Date(now.getTime() + 46_000));
  await assert.rejects(balanceHostGrantIssue(bound, request));
});

test('grant sponsor only admits the original proved owner call and rejects a wallet substitution', async () => {
  const state = pinnedState();
  const r = runtime(state);
  const driver = createReferenceHostDriver(r);
  const random = Ledger.communicationCommitmentRandomness();
  const ttl = new Date(Date.now() + 60_000);
  const proved = await provedCall(circuit, random, false, ttl);
  const input = {
    kind: 'grant-issue-v1',
    tx: Buffer.from(proved.serialize()).toString('hex'),
    requestId,
    address,
    circuit,
  };
  const plan = await driver.prepare(identity, input);
  const disabled = createReferenceHostDriver({ ...r, allowGrantIssue: false });
  await assert.rejects(disabled.prepare(identity, input));
  await assert.rejects(driver.prepare(identity, { ...input, validUntilSeconds: 0 }));
  await assert.rejects(driver.prepare({ ...identity, requestId: '01'.repeat(16) + ':0' }, input));
  await assert.rejects(
    driver.prepare({ ...identity, pins: { ...pins, scheme: 'p256-webauthn' } }, input),
  );
  const wrong = await provedCall('revoke_grant_with_jubjub');
  await assert.rejects(
    driver.prepare(identity, { ...input, tx: Buffer.from(wrong.serialize()).toString('hex') }),
  );
  await assert.rejects(
    driver.prepare(identity, {
      ...input,
      tx: Buffer.from(proved.bind().serialize()).toString('hex'),
    }),
  );
  const paying = await provedCall(circuit, random, true, ttl);
  await assert.rejects(
    driver.prepare(identity, { ...input, tx: Buffer.from(paying.serialize()).toString('hex') }),
  );
  const extended = await provedCall(circuit, random, false, new Date(ttl.getTime() + 30_000));
  const empty = Ledger.Transaction.fromParts(pins.networkId).addIntent(
    { tag: 'specific', value: 2 },
    Ledger.Intent.new(ttl),
  );
  const extra = proved
    .bind()
    .merge((await empty.prove(proving, Ledger.CostModel.initialCostModel())).bind());
  assert.equal(extra.intents?.size, 2);
  for (const substitute of [
    (await provedCall(circuit, undefined, false, ttl)).bind(),
    paying.bind(),
    extended.bind(),
    extra,
  ]) {
    const substituted = createReferenceHostDriver({
      ...r,
      providers: {
        ...r.providers,
        walletProvider: {
          ...r.providers.walletProvider,
          balanceTx: async () => ({ version: 'v9', tx: substitute }),
        },
      },
    });
    await assert.rejects(
      substituted.prepareStep(
        {
          version: 1,
          revision: 0,
          identity,
          input,
          owner: 'fixture',
          phase: 'active',
          plan,
          steps: [],
        },
        0,
      ),
    );
  }
});

async function start(
  t: TestContext,
  driver: ReturnType<typeof createReferenceHostDriver>,
  root: string,
  routePins: HostMutationIdentity['pins'] = pins,
) {
  const store = encryptedHostMutationStore(root, new Uint8Array(32).fill(7));
  const executor = createHostMutationExecutor(store, driver);
  const route = hostMutationRoute({ executor, pins: routePins, token: Buffer.from(token, 'hex') });
  const server = createServer({ host: '127.0.0.1', corsOrigin: 'https://passport.example' }, [
    route,
  ]);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const endpoint = server.address();
  assert.ok(endpoint && typeof endpoint !== 'string');
  const base = `http://127.0.0.1:${endpoint.port}`;
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    store.close();
  };
  t.after(close);
  return { base, close };
}

function issueChain(
  built: Ledger.UnprovenTransaction,
  prover: Parameters<typeof createMidnightChain>[0]['prover'],
  grantIssueSponsor: NonNullable<Parameters<typeof createMidnightChain>[0]['grantIssueSponsor']>,
  expectedCircuit: string = circuit,
) {
  const buildGrantIssue: NonNullable<
    Parameters<typeof createMidnightChain>[0]['buildGrantIssue']
  > = async (_providers: unknown, options: { contractAddress: string; circuitId: string }) => {
    assert.equal(options.contractAddress, address);
    assert.equal(options.circuitId, expectedCircuit);
    return { private: { unprovenTx: built } } as never;
  };
  return createDeadlineFencedGrantIssueChain({
    network: {
      ...pins,
      nodeUrl: 'http://localhost:19944',
      indexerUrl: 'http://localhost:18088/api/v4/graphql',
      indexerWsUrl: 'ws://localhost:18088/api/v4/graphql/ws',
      artefactUrl: 'http://localhost:8787/v1/zk/acc-s3r1.1',
    },
    binding,
    prover,
    grantIssueSponsor,
    buildGrantIssue,
    sponsor: { balanceAndSign: unused },
    submitter: { submit: unused },
    sponsorKeys: { coinPublicKey: 'ab'.repeat(32), encryptionPublicKey: 'bc'.repeat(32) },
  });
}

test('grant chain proves the selected issue before handing the exact unbound bytes to the sponsor', async (t) => {
  const now = Date.now();
  t.mock.timers.enable({ apis: ['Date'], now });
  const random = Ledger.communicationCommitmentRandomness();
  const ttl = new Date(now + 60_000);
  const built = unprovenCall(circuit, random, false, ttl);
  const proved = await built.prove(proving, Ledger.CostModel.initialCostModel());
  const validUntilSeconds = Math.floor(Date.now() / 1000) + 60;
  const mutation = { requestId, intentSha256, validUntilSeconds };
  const request = { address, circuit, args: [], mutation } as const;
  let proofs = 0;
  let handoffs = 0;
  let substitute = proved;
  let expireDuringProof = false;
  const chain = issueChain(
    built,
    {
      async proveTx(tx, context) {
        proofs++;
        assert.deepEqual(tx, built.serialize());
        assert.deepEqual(context.circuits, [circuit]);
        if (expireDuringProof) t.mock.timers.setTime(now + 61_000);
        return { tx: substitute.serialize(), provenance: 'local' };
      },
    },
    {
      async execute(bytes, original) {
        handoffs++;
        assert.deepEqual(bytes, proved.serialize());
        assert.deepEqual(original, { ...mutation, address, circuit });
        return { txHash: 'ae'.repeat(32), blockHeight: 7 };
      },
    },
  );
  assert.deepEqual(await chain.submitDeadlineFencedGrantIssue(request), {
    txHash: 'ae'.repeat(32),
    blockHeight: 7,
  });
  substitute = await provedCall(circuit, random, false, new Date(now + 90_000));
  await assert.rejects(chain.submitDeadlineFencedGrantIssue(request), {
    code: 'MutationUnsettled',
  });
  substitute = await provedCall(circuit, undefined, false, ttl);
  await assert.rejects(chain.submitDeadlineFencedGrantIssue(request), {
    code: 'MutationUnsettled',
  });
  await assert.rejects(
    chain.submitDeadlineFencedGrantIssue({
      ...request,
      mutation: { ...mutation, validUntilSeconds: validUntilSeconds - 120 },
    }),
    { code: 'MutationUnsettled' },
  );
  substitute = proved;
  expireDuringProof = true;
  await assert.rejects(chain.submitDeadlineFencedGrantIssue(request), {
    code: 'MutationUnsettled',
  });
  assert.deepEqual([proofs, handoffs], [4, 1]);
});

for (const scheme of ['jubjub-schnorr', 'p256-webauthn'] as const) {
  test(`${scheme} private grant sponsor RPC recovers the exact original dispatch after a lost reply and restart`, async (t) => {
    const circuit =
      scheme === 'p256-webauthn' ? 'issue_grant_with_p256' : 'issue_grant_with_jubjub';
    const routePins = { ...pins, scheme };
    const root = await mkdtemp(join(tmpdir(), 'passport-grant-sponsor-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const built = unprovenCall(circuit, undefined, false, new Date(Date.now() + 3_600_000));
    const proved = await built.prove(proving, Ledger.CostModel.initialCostModel());
    const exact = proved.bind();
    const expectedBytes = exact.serialize();
    const r = runtime(pinnedState());
    let balances = 0;
    let sends = 0;
    const driver = createReferenceHostDriver({
      ...r,
      providers: {
        ...r.providers,
        walletProvider: {
          ...r.providers.walletProvider,
          async balanceTx({ tx }, feeDeadline) {
            balances++;
            assert.ok(feeDeadline && feeDeadline.getTime() > Date.now());
            assert.ok(feeDeadline.getTime() <= Date.now() + 45_000);
            assert.deepEqual(tx.serialize(), proved.serialize());
            return { version: 'v9', tx: exact };
          },
        },
        midnightProvider: {
          async submitTx({ tx }) {
            sends++;
            assert.deepEqual(tx.serialize(), expectedBytes);
            throw new Error('Original wallet acknowledgement was lost');
          },
        },
      },
      async fetch() {
        return Response.json({
          data: {
            transactions: sends
              ? [
                  {
                    __typename: 'RegularTransaction',
                    protocolVersion: 2001000,
                    raw: Buffer.from(expectedBytes).toString('hex'),
                    hash: exact.transactionHash(),
                    identifiers: exact.identifiers(),
                    block: { height: 7 },
                    transactionResult: { status: 'SUCCESS' },
                  },
                ]
              : [],
          },
        });
      },
    });
    const first = await start(t, driver, root, routePins);
    const request = {
      requestId,
      intentSha256,
      address,
      circuit,
      validUntilSeconds: Math.floor(Date.now() / 1000) + 60,
    };
    const denied = remoteHostMutationPorts(first.base, {
      pins: routePins,
      token: '91'.repeat(32),
    }).grantIssue;
    await assert.rejects(denied.execute(proved.serialize(), request), {
      code: 'MutationUnsettled',
    });
    assert.deepEqual([balances, sends], [0, 0]);
    const wrongScheme = remoteHostMutationPorts(first.base, {
      pins: {
        ...routePins,
        scheme: scheme === 'p256-webauthn' ? 'jubjub-schnorr' : 'p256-webauthn',
      },
      token,
    }).grantIssue;
    await assert.rejects(wrongScheme.execute(proved.serialize(), request), {
      code: 'MutationUnsettled',
    });
    assert.deepEqual([balances, sends], [0, 0]);
    const port = remoteHostMutationPorts(first.base, { pins: routePins, token }).grantIssue;
    const chain = issueChain(
      built,
      {
        async proveTx(bytes) {
          assert.deepEqual(bytes, built.serialize());
          return { tx: proved.serialize(), provenance: 'remote' };
        },
      },
      port,
      circuit,
    );
    await assert.rejects(
      chain.submitDeadlineFencedGrantIssue({
        address,
        circuit,
        args: [],
        mutation: { requestId, intentSha256, validUntilSeconds: request.validUntilSeconds },
      }),
      { code: 'MutationUnsettled' },
    );
    assert.deepEqual([balances, sends], [1, 1]);
    await first.close();
    const restarted = await start(t, driver, root, routePins);
    const recovered = remoteHostMutationPorts(restarted.base, {
      pins: routePins,
      token,
    }).grantIssue;
    await assert.rejects(recovered.reconcile({ requestId, intentSha256: '15'.repeat(32) }), {
      code: 'MutationUnsettled',
    });
    assert.deepEqual(await recovered.reconcile(request), {
      txHash: exact.transactionHash(),
      submissionId: exact.identifiers()[0],
      blockHeight: 7,
    });
    await assert.rejects(recovered.execute((await provedCall()).serialize(), request), {
      code: 'MutationUnsettled',
    });
    assert.deepEqual([balances, sends], [1, 1]);
  });
}

test('grant sponsor does not send a prepared issue after its request expires during balance', async (t) => {
  const now = Date.now();
  t.mock.timers.enable({ apis: ['Date'], now });
  const root = await mkdtemp(join(tmpdir(), 'passport-grant-sponsor-deadline-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = encryptedHostMutationStore(root, new Uint8Array(32).fill(7));
  t.after(() => store.close());
  const proved = await provedCall();
  const r = runtime(pinnedState());
  let balances = 0;
  const driver = createReferenceHostDriver({
    ...r,
    providers: {
      ...r.providers,
      walletProvider: {
        ...r.providers.walletProvider,
        async balanceTx() {
          balances++;
          t.mock.timers.setTime(now + 15_000);
          return { version: 'v9', tx: proved.bind() };
        },
      },
    },
  });
  const executor = createHostMutationExecutor(store, driver);
  const result = await executor.execute(identity, {
    kind: 'grant-issue-v1',
    address,
    circuit,
    requestId,
    validUntilSeconds: Math.floor(now / 1000) + 5,
    tx: Buffer.from(proved.serialize()).toString('hex'),
  });
  assert.equal(result.kind, 'unknown');
  assert.equal((await store.read(identity))?.steps[0]?.phase, 'ready');
  assert.equal((await executor.resume(identity)).kind, 'unknown');
  assert.equal(balances, 1);
});

for (const phase of ['account snapshot', 'dispatch fence'] as const) {
  test(`grant sponsor refuses broadcast when the signed deadline passes during the ${phase}`, async (t) => {
    const now = Date.now();
    t.mock.timers.enable({ apis: ['Date'], now });
    const root = await mkdtemp(join(tmpdir(), 'passport-grant-final-deadline-'));
    const store = encryptedHostMutationStore(root, new Uint8Array(32).fill(7));
    t.after(async () => {
      store.close();
      await rm(root, { recursive: true, force: true });
    });
    const state = pinnedState();
    const proved = await provedCall();
    const r = runtime(state);
    let sends = 0;
    let expiredAtBoundary = false;
    const expire = () => {
      expiredAtBoundary = true;
      t.mock.timers.setTime(now + 15_000);
    };
    const driver = createReferenceHostDriver({
      ...r,
      providers: {
        ...r.providers,
        publicDataProvider: {
          async queryContractState() {
            if (
              phase === 'account snapshot' &&
              (await store.read(identity))?.steps[0]?.phase === 'ready'
            )
              expire();
            return state;
          },
        },
        walletProvider: {
          ...r.providers.walletProvider,
          async balanceTx({ tx }) {
            assert.deepEqual(tx.serialize(), proved.serialize());
            return { version: 'v9', tx: proved.bind() };
          },
        },
        midnightProvider: {
          async submitTx() {
            sends++;
            throw new Error('Expired grant reached the provider.');
          },
        },
      },
      fetch: async () => Response.json({ data: { transactions: [] } }),
    });
    const executor = createHostMutationExecutor(
      {
        read: (key) => store.read(key),
        async compareAndSwap(expected, next) {
          const saved = await store.compareAndSwap(expected, next);
          if (saved && phase === 'dispatch fence' && next.steps[0]?.phase === 'dispatching')
            expire();
          return saved;
        },
      },
      driver,
    );
    const input = {
      kind: 'grant-issue-v1',
      address,
      circuit,
      requestId,
      validUntilSeconds: Math.floor(now / 1000) + 5,
      tx: Buffer.from(proved.serialize()).toString('hex'),
    };
    if (phase === 'account snapshot') {
      assert.deepEqual(await executor.execute(identity, input), { kind: 'unknown' });
    } else {
      await assert.rejects(executor.execute(identity, input), /reconcile the original/);
    }
    assert.ok(expiredAtBoundary);
    assert.equal(sends, 0);
    assert.equal(
      (await store.read(identity))?.steps[0]?.phase,
      phase === 'account snapshot' ? 'ready' : 'dispatching',
    );
    assert.deepEqual(await executor.resume(identity), { kind: 'unknown' });
    assert.equal(sends, 0);
  });
}
