import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  encryptedHostMutationStore,
  createHostMutationExecutor,
} from '@input-output-hk/mn-passport-service';
import { gunzipSync } from 'node:zlib';
import { createReferenceHostDriver, readHostConfirmation } from '../src/host-driver.ts';
import type {
  HostMutationIdentity,
  HostMutationRecord,
} from '@input-output-hk/mn-passport-service';
const requireAdapter = createRequire(
  new URL('../../../packages/adapter-midnight-js/package.json', import.meta.url),
);
const protocol: any = await import(
  pathToFileURL(
    createRequire(
      requireAdapter.resolve('@midnight-ntwrk/midnight-js-indexer-public-data-provider'),
    ).resolve('@midnight-ntwrk/midnight-js-protocol'),
  ).href
);
const L: any = await import(pathToFileURL(requireAdapter.resolve('@midnightntwrk/ledger-v9')).href);
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const proving = {
  check: async () => [],
  prove: async () => new Uint8Array(),
  lookupKey: async () => undefined,
};
async function tx() {
  return (
    await L.Transaction.fromParts(
      'undeployed',
      undefined,
      undefined,
      L.Intent.new(new Date(Date.now() + 60000)),
    ).prove(proving, L.CostModel.initialCostModel())
  ).bind();
}

test('bounded finality read requires successful raw v9 bytes, exact watch id and matching included hash', async (t) => {
  const value = await tx(),
    identifier = value.identifiers()[0];
  assert.ok(identifier);
  const result: any = {
    __typename: 'RegularTransaction',
    protocolVersion: 2001000,
    raw: hex(value.serialize()),
    hash: value.transactionHash(),
    identifiers: [identifier],
    block: { height: 7 },
    transactionResult: { status: 'SUCCESS' },
  };
  const step = {
    tx: hex(value.serialize()),
    identifiers: [identifier],
    phase: 'dispatching' as const,
  };
  const source = {
    ledger: L,
    versionOfRecord: protocol.versionOfRecord,
    indexerUrl: 'http://indexer',
    fetch: async () =>
      new Response(JSON.stringify({ data: { transactions: [result] } }), { status: 200 }),
  };
  assert.equal(identifier.length, 66, 'native ledger watch IDs are tagged 33-byte values');
  const dir = await mkdtemp(join(tmpdir(), 'passport-native-id-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = encryptedHostMutationStore(dir, new Uint8Array(32).fill(7));
  t.after(() => store.close());
  const executor = createHostMutationExecutor(store, {
    prepare: async () => ({ address: '12'.repeat(32), steps: 1, context: {} }),
    prepareStep: async () => ({ tx: step.tx, identifiers: step.identifiers }),
    submit: async () => identifier,
    lookup: (s) => readHostConfirmation(s, source),
    check: async () => true,
  });
  const identity: HostMutationIdentity = {
    pins: {
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      scheme: 'jubjub-schnorr',
      manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
    },
    kind: 'call',
    requestId: '12'.repeat(16) + ':0',
    intentSha256: '34'.repeat(32),
  };
  const completed = await executor.execute(identity, {});
  assert.equal(completed.kind, 'confirmed');
  assert.equal((await store.read(identity))!.steps[0]!.confirmation!.identifier, identifier);
  assert.deepEqual(await readHostConfirmation(step, source), {
    identifier,
    txHash: value.transactionHash(),
    blockHeight: 7,
    succeeded: true,
  });
  assert.equal(
    await readHostConfirmation(
      { ...step, identifiers: [identifier, '00' + 'ff'.repeat(32)] },
      source,
    ),
    undefined,
    'One matched fee/watch ID cannot confirm an omitted prepared intent',
  );
  for (const change of [
    { transactionResult: { status: 'PARTIAL_SUCCESS' } },
    { transactionResult: { status: 'FAILURE' } },
    { protocolVersion: 1001000 },
    { protocolVersion: 30000 },
    { protocolVersion: '2001000' },
    { hash: '00'.repeat(32) },
    { raw: hex((await tx()).serialize()) },
    { identifiers: ['11'.repeat(32)] },
    { block: { height: -1 } },
    { __typename: 'SystemTransaction' },
  ]) {
    const fake = { ...result, ...change };
    assert.equal(
      await readHostConfirmation(step, {
        ...source,
        fetch: async () => new Response(JSON.stringify({ data: { transactions: [fake] } })),
      }),
      undefined,
    );
  }
  assert.equal(
    await readHostConfirmation(step, {
      ...source,
      fetch: async () => new Response(JSON.stringify({ data: { transactions: [] } })),
    }),
    undefined,
  );
});

test('driver builds real ledger deployment and maintenance bytes and refuses changed verifier/authority frontiers', async (t) => {
  // The default lane uses bundled verifier bytes and a constructor-only compiled contract.
  // No prover, wallet daemon, node or imported reference checkout is required.
  const resources: any = JSON.parse(
    gunzipSync(
      await readFile(
        new URL('../../../packages/contract/resources/acc-s3r1.1.zkir.json.gz', import.meta.url),
      ),
    ).toString(),
  );
  const { CompiledContract }: any = await import(
    pathToFileURL(
      requireAdapter.resolve('@midnight-ntwrk/compact-js').replace('/dist/cjs/', '/dist/esm/'),
    ).href
  );
  const C: any = await import('../../../packages/contract/generated/acc-s3r1.1/index.js');
  const contracts: any = await import(
    pathToFileURL(requireAdapter.resolve('@midnight-ntwrk/midnight-js-contracts')).href
  );
  const network: any = await import(
    pathToFileURL(requireAdapter.resolve('@midnight-ntwrk/midnight-js-network-id')).href
  );
  network.setNetworkId('undeployed');
  // Use a test planner independent from the external reference checkout. The runtime adapter
  // validates exact coverage, byte budgets and retirement position before anything is submitted.
  const names = Object.keys(C.pureCircuits);
  assert.ok(names.length > 0);
  const circuits = Object.keys(resources.files)
    .filter((name) => name.startsWith('keys/') && name.endsWith('.verifier'))
    .map((name) => name.slice(5, -9));
  if (!circuits.length) throw new Error('unexpected bundled verifier format');
  const getVerifierKey = async (name: string) =>
    new Uint8Array(Buffer.from(resources.files[`keys/${name}.verifier`], 'base64'));
  let observed: any;
  const providers = {
    zkConfigProvider: { getVerifierKey },
    walletProvider: {
      getCoinPublicKey: () => '11'.repeat(32),
      getEncryptionPublicKey: () => '22'.repeat(32),
      balanceTx: async (r: any) => ({ version: 'v9', tx: r.tx.bind() }),
    },
    publicDataProvider: { queryContractState: async () => observed },
  };
  const planWaves = (sizes: Map<string, number>, _arm: string, retire: boolean) => {
    const waves: any[] = [];
    let list: string[] = [],
      size = 0;
    for (const [name, n] of sizes) {
      if (size + n > 15000) {
        waves.push({
          index: waves.length + 1,
          kind: waves.length ? 'maintenance' : 'deploy',
          circuits: list,
          verifierBytes: size,
          retiresAuthority: false,
        });
        list = [];
        size = 0;
      }
      list.push(name);
      size += n;
    }
    if (list.length)
      waves.push({
        index: waves.length + 1,
        kind: waves.length ? 'maintenance' : 'deploy',
        circuits: list,
        verifierBytes: size,
        retiresAuthority: retire,
      });
    return waves;
  };
  const runtime = {
    ledger: L,
    versionOfRecord: protocol.versionOfRecord,
    contracts,
    waves: { allCircuits: () => circuits, planWaves },
    signer: {
      JubjubDevice: {
        generate: () => ({ pk: C.pureCircuits.compute_public_point_with_jubjub(7n) }),
      },
    },
    setup: {
      compiledAccountContract: () =>
        CompiledContract.make('account', C.Contract).pipe(
          CompiledContract.withWitnesses({
            held_coin: () => {
              throw new Error('unused witness');
            },
          }),
        ),
    },
    witnesses: { emptyCoinStore: () => ({}) },
    providers,
    proving,
    networkId: 'undeployed',
    indexerUrl: 'http://unused',
    allowedAccount: () => true,
    deploymentCompleted: () => {},
  };
  const driver = createReferenceHostDriver(runtime),
    identity: HostMutationIdentity = {
      pins: {
        networkId: 'undeployed',
        bindingId: 'acc-s3r1.1',
        manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
        scheme: 'p256-webauthn',
      },
      requestId: '34'.repeat(16) + ':0',
      intentSha256: '56'.repeat(32),
      kind: 'deploy',
    };
  const input = {
    boot: '11'.repeat(32),
    encKey: '22'.repeat(32),
    retireAuthority: true,
    firstArm: 'p256',
  };
  const plan = await driver.prepare(identity, input);
  let record: HostMutationRecord = {
    version: 1,
    revision: 1,
    identity,
    input,
    owner: 'test',
    phase: 'active',
    plan,
    steps: [],
  };
  const privateDir = await mkdtemp(join(tmpdir(), 'passport-native-plan-'));
  try {
    const store = encryptedHostMutationStore(privateDir, new Uint8Array(32).fill(3));
    assert.equal(await store.compareAndSwap(undefined, { ...record, revision: 0 }), true);
    const persisted = await store.read(identity);
    assert.ok(persisted);
    record = persisted;
    store.close();
  } finally {
    await rm(privateDir, { recursive: true, force: true });
  }
  assert.equal(await driver.check(record, 0), true);
  const prepared = await driver.prepareStep(record, 0);
  assert.ok(prepared.identifiers.length);
  const decoded = L.Transaction.deserialize(
    'signature',
    'proof',
    'binding',
    Buffer.from(prepared.tx, 'hex'),
  );
  assert.deepEqual(decoded.identifiers(), prepared.identifiers);
  const expired = (
    await L.Transaction.fromParts(
      'undeployed',
      undefined,
      undefined,
      L.Intent.new(new Date(Date.now() - 60000)),
    ).prove(proving, L.CostModel.initialCostModel())
  ).bind();
  assert.equal(
    await driver.check(
      {
        ...record,
        steps: [
          { phase: 'ready', tx: hex(expired.serialize()), identifiers: expired.identifiers() },
        ],
      },
      0,
    ),
    false,
    'Expired prepared bytes must be refused before entering dispatching.',
  );
  const nearlyExpired = (
    await L.Transaction.fromParts(
      'undeployed',
      undefined,
      undefined,
      L.Intent.new(new Date(Date.now() + 500)),
    ).prove(proving, L.CostModel.initialCostModel())
  ).bind();
  assert.equal(
    await driver.check(
      {
        ...record,
        steps: [
          {
            phase: 'ready',
            tx: hex(nearlyExpired.serialize()),
            identifiers: nearlyExpired.identifiers(),
          },
        ],
      },
      0,
    ),
    false,
  );
  const expiredPlan = structuredClone(record);
  const context = expiredPlan.plan!.context as any;
  const old = L.Transaction.deserialize(
    'signature',
    'pre-proof',
    'pre-binding',
    Buffer.from(context.deployTx, 'hex'),
  );
  const deployAction = [...old.intents.values()][0].actions[0];
  context.deployTx = hex(
    L.Transaction.fromParts(
      'undeployed',
      undefined,
      undefined,
      L.Intent.new(new Date(Date.now() - 60000)).addDeploy(deployAction),
    ).serialize(),
  );
  await assert.rejects(driver.prepareStep(expiredPlan, 0), /host mutation/i);

  observed = [...decoded.intents.values()][0].actions[0].initialState;
  assert.equal(await driver.check(record, 1), true);
  const firstState = L.ContractState.deserialize(observed.serialize());
  for (let index = 1; index < plan.steps; index++) {
    const output = await driver.prepareStep(record, index);
    const tx = L.Transaction.deserialize(
      'signature',
      'proof',
      'binding',
      Buffer.from(output.tx, 'hex'),
    );
    const action = [...tx.intents.values()][0].actions[0];
    assert.ok(action instanceof L.MaintenanceUpdate);
    assert.equal(action.address, plan.address);
    assert.equal(action.counter, BigInt(index - 1));
    assert.equal(
      L.verifySignature(
        observed.maintenanceAuthority.committee[0],
        action.dataToSign,
        action.signatures[0][1],
      ),
      true,
    );
    let replacement;
    for (const update of action.updates) {
      if (update instanceof L.VerifierKeyInsert) {
        assert.equal(update.vk.version, 'v4');
        const expected = L.ContractState.deserialize(
          Buffer.from((plan.context as any).state, 'hex'),
        ).operation(update.operation);
        assert.deepEqual(
          update.vk.rawVk,
          new L.ContractOperationVersionedVerifierKey('v4', expected.verifierKey).rawVk,
        );
        observed.setOperation(update.operation, expected);
      } else {
        assert.ok(update instanceof L.ReplaceAuthority);
        replacement = update.authority;
      }
    }
    observed.maintenanceAuthority =
      replacement ??
      new L.ContractMaintenanceAuthority(
        observed.maintenanceAuthority.committee,
        observed.maintenanceAuthority.threshold,
        BigInt(index),
      );
    assert.equal(await driver.check(record, index + 1), true);
  }
  assert.equal(observed.operations().length, 52);
  assert.equal(observed.maintenanceAuthority.committee.length, 0);
  assert.equal(observed.maintenanceAuthority.threshold, 1);
  observed = firstState;
  for (const [arm, retire] of [
    ['p256', false],
    ['jubjub', true],
    ['jubjub', false],
  ] as const) {
    const i = {
      ...identity,
      pins: {
        ...identity.pins,
        scheme: arm === 'p256' ? ('p256-webauthn' as const) : ('jubjub-schnorr' as const),
      },
    };
    const original = { ...input, firstArm: arm, retireAuthority: retire };
    const p = await driver.prepare(i, original);
    const rec = { ...record, identity: i, input: original, plan: p };
    observed = undefined;
    for (let index = 0; index < p.steps; index++) {
      const output = await driver.prepareStep(rec, index),
        transaction = L.Transaction.deserialize(
          'signature',
          'proof',
          'binding',
          Buffer.from(output.tx, 'hex'),
        );
      const action = [...transaction.intents.values()][0].actions[0];
      if (index === 0) {
        assert.ok(action instanceof L.ContractDeploy);
        assert.equal(action.address, p.address);
        observed = action.initialState;
      } else {
        assert.ok(action instanceof L.MaintenanceUpdate);
        assert.equal(action.counter, BigInt(index - 1));
        assert.equal(
          L.verifySignature(
            observed.maintenanceAuthority.committee[0],
            action.dataToSign,
            action.signatures[0][1],
          ),
          true,
        );
        let replacement;
        for (const update of action.updates) {
          if (update instanceof L.VerifierKeyInsert) {
            const op = L.ContractState.deserialize(
              Buffer.from((p.context as any).state, 'hex'),
            ).operation(update.operation);
            assert.deepEqual(
              update.vk.rawVk,
              new L.ContractOperationVersionedVerifierKey('v4', op.verifierKey).rawVk,
            );
            observed.setOperation(update.operation, op);
          } else {
            assert.ok(update instanceof L.ReplaceAuthority);
            assert.equal(index, p.steps - 1);
            assert.equal(retire, true);
            replacement = update.authority;
          }
        }
        observed.maintenanceAuthority =
          replacement ??
          new L.ContractMaintenanceAuthority(
            observed.maintenanceAuthority.committee,
            observed.maintenanceAuthority.threshold,
            BigInt(index),
          );
      }
      assert.equal(await driver.check(rec, index + 1), true);
    }
    assert.equal(observed.operations().length, 52);
    assert.equal(observed.maintenanceAuthority.committee.length, retire ? 0 : 1);
  }
  observed = firstState;
  const good = observed.maintenanceAuthority;
  observed.maintenanceAuthority = new L.ContractMaintenanceAuthority([], 1, 0n);
  assert.equal(await driver.check(record, 1), false);
  observed.maintenanceAuthority = good;
  observed.setOperation(
    circuits.at(-1),
    L.ContractState.deserialize(Buffer.from((plan.context as any).state, 'hex')).operation(
      circuits.at(-1),
    ),
  );
  assert.equal(await driver.check(record, 1), false);
  const wrong = createReferenceHostDriver({
    ...runtime,
    waves: {
      ...runtime.waves,
      planWaves: (...args: any[]) => {
        const result = planWaves(args[0], args[1], args[2]);
        result[0].retiresAuthority = true;
        return result;
      },
    },
  });
  await assert.rejects(wrong.prepare(identity, input));
  t.diagnostic(
    'Offline ledger serialization/frontier guard; no proof-backed or node acceptance claim.',
  );
});
