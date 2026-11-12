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
import { remoteHostMutationPorts } from '../../../packages/adapter-service/dist/index.js';
import { createReferenceHostDriver } from '../src/host-driver.ts';
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
const { files } = JSON.parse(
  gunzipSync(
    await readFile(
      new URL('../../../packages/contract/resources/acc-s3r1.1.zkir.json.gz', import.meta.url),
    ),
  ).toString(),
) as { files: Record<string, string> };
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

async function provedCall(
  name = circuit,
  random = Ledger.communicationCommitmentRandomness(),
  paysValue = false,
  ttl = new Date(Date.now() + 60_000),
) {
  const empty = { value: [], alignment: [] };
  const call = new Ledger.ContractCallPrototype(
    address,
    name,
    new Ledger.ContractOperation(),
    undefined,
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
  const unproven = Ledger.Transaction.fromParts(pins.networkId, undefined, undefined, intent);
  return unproven.prove(proving, Ledger.CostModel.initialCostModel());
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
) {
  const store = encryptedHostMutationStore(root, new Uint8Array(32).fill(7));
  const executor = createHostMutationExecutor(store, driver);
  const route = hostMutationRoute({ executor, pins, token: Buffer.from(token, 'hex') });
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

test('private grant sponsor RPC recovers the exact original dispatch after a lost reply and restart', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'passport-grant-sponsor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const proved = await provedCall();
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
        async balanceTx({ tx }) {
          balances++;
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
  const first = await start(t, driver, root);
  const request = { requestId, intentSha256, address, circuit };
  const denied = remoteHostMutationPorts(first.base, { pins, token: '91'.repeat(32) }).grantIssue;
  await assert.rejects(denied.execute(proved.serialize(), request), { code: 'MutationUnsettled' });
  assert.deepEqual([balances, sends], [0, 0]);
  const port = remoteHostMutationPorts(first.base, { pins, token }).grantIssue;
  await assert.rejects(port.execute(proved.serialize(), request), { code: 'MutationUnsettled' });
  assert.deepEqual([balances, sends], [1, 1]);
  await first.close();
  const restarted = await start(t, driver, root);
  const recovered = remoteHostMutationPorts(restarted.base, { pins, token }).grantIssue;
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
