import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  realpathSync,
  readFileSync,
  lstatSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { inspect } from 'node:util';
import { spawnSync } from 'node:child_process';
import { nativeLeasePath } from '../scripts/qualification/native-lease.mjs';
import { tmpdir } from 'node:os';
import {
  nativeContainer,
  nativeRunningContainer,
  nativeBlockCapacity,
  nativeScope,
  nativeResult,
  nativeFinality,
} from '../scripts/qualify-published-native-host.mjs';
const project = 'mn-passport-qual-20261023';
function container() {
  return {
    Name: '/' + project + '-node-1',
    Id: 'ab'.repeat(32),
    Image: 'sha256:' + 'cd'.repeat(32),
    State: { Running: false },
    Config: {
      Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': 'node' },
    },
    HostConfig: { PortBindings: { '9944/tcp': [{ HostIp: '127.0.0.1', HostPort: '19954' }] } },
    Mounts: [{ Type: 'volume', Name: project + '_node-data', Destination: '/data' }],
  };
}
test('native lease is exclusive across processes with different Nix temporary directories', () => {
  const home = mkdtempSync(join(tmpdir(), 'native-lease-process-'));
  try {
    const firstTemp = join(home, 'shell-a'),
      secondTemp = join(home, 'shell-b');
    mkdirSync(firstTemp);
    mkdirSync(secondTemp);
    const module = new URL('../scripts/qualification/native-lease.mjs', import.meta.url).href;
    const source = `import {nativeLeasePath} from ${JSON.stringify(module)};
      import {writeFileSync} from 'node:fs';
      try { writeFileSync(nativeLeasePath(process.argv[1]), 'original-intent', {flag:'wx',mode:0o600}); }
      catch (error) { if(error.code === 'EEXIST') process.exit(23); throw error; }`;
    const run = (/** @type {string} */ temporary) =>
      spawnSync(process.execPath, ['--input-type=module', '-e', source, home], {
        env: { ...process.env, TMPDIR: temporary },
        encoding: 'utf8',
        timeout: 15000,
      });
    assert.equal(run(firstTemp).status, 0);
    assert.equal(
      run(secondTemp).status,
      23,
      'A different Nix shell must not acquire the same lease',
    );
    assert.equal(readFileSync(nativeLeasePath(home), 'utf8'), 'original-intent');
    assert.equal(lstatSync(nativeLeasePath(home)).mode & 0o077, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('native lease refuses an exposed or redirected directory without rewriting it', () => {
  const home = mkdtempSync(join(tmpdir(), 'native-lease-owner-'));
  try {
    const target = join(home, '.midnight-passport-native-qualification');
    mkdirSync(target, { mode: 0o755 });
    chmodSync(target, 0o755);
    assert.throws(() => nativeLeasePath(home), /private/);
    assert.equal(lstatSync(target).mode & 0o777, 0o755);
    rmSync(target, { recursive: true });
    const elsewhere = join(home, 'elsewhere');
    mkdirSync(elsewhere, { mode: 0o700 });
    symlinkSync(elsewhere, target);
    assert.throws(() => nativeLeasePath(home), /link/);
    assert.ok(lstatSync(target).isSymbolicLink());
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('native capacity refuses a current indexed node whose mandatory work consumes user headroom', () => {
  const live = {
    maxBlock: '2000000000000',
    maxNormal: '1299891843000',
    baseExtrinsic: '108157000',
    mandatory: '2022693531255',
    operational: '0',
  };
  assert.equal(nativeBlockCapacity(live), false);
  assert.equal(nativeBlockCapacity({ ...live, mandatory: '200000000000' }), true);
  assert.equal(
    nativeBlockCapacity({ ...live, mandatory: '200000000000', operational: '600000000000' }),
    false,
  );
  for (const bad of ['-1', 'NaN', '1.5', '', '1e12'])
    assert.throws(() => nativeBlockCapacity({ ...live, mandatory: bad }));
  assert.throws(() => nativeBlockCapacity({ ...live, maxNormal: '3000000000000' }));
});

test('native control refuses a shared/default project, wrong identity, public port or foreign volume', () => {
  const good = container();
  assert.equal(nativeContainer(good, project + '-node-1').id, good.Id);
  /** @type {Array<(c: ReturnType<typeof container>)=>void>} */ const changes = [
    (c) => {
      c.Name = '/mn-passport-sdk-localnet-node-1';
    },
    (c) => {
      c.Config.Labels['com.docker.compose.project'] = 'unrelated';
    },
    (c) => {
      c.Config.Labels['com.docker.compose.service'] = 'indexer';
    },
    (c) => {
      assert.ok(c.HostConfig.PortBindings['9944/tcp'][0]);
      c.HostConfig.PortBindings['9944/tcp'][0].HostIp = '0.0.0.0';
    },
    (c) => {
      assert.ok(c.HostConfig.PortBindings['9944/tcp'][0]);
      c.HostConfig.PortBindings['9944/tcp'][0].HostPort = '9944';
    },
    (c) => {
      assert.ok(c.Mounts[0]);
      c.Mounts[0].Name = 'another_node-data';
    },
    (c) => {
      c.Image = 'mutable:latest';
    },
  ];
  for (const change of changes) {
    const altered = structuredClone(good);
    change(altered);
    assert.throws(() => nativeContainer(altered, project + '-node-1'));
  }
});

test('native readiness requires the actual owned port and a live dedicated network endpoint', () => {
  const original = container(),
    expected = nativeContainer(original, project + '-node-1');
  const running = {
    ...original,
    State: { Running: true },
    NetworkSettings: {
      Ports: { ...structuredClone(original.HostConfig.PortBindings), '30333/tcp': null },
      Networks: {
        [project + '_midnight']: { IPAddress: '172.19.0.3', EndpointID: 'ef'.repeat(32) },
      },
    },
  };
  assert.equal(nativeRunningContainer(running, expected).id, expected.id);
  assert.throws(
    () =>
      nativeRunningContainer(
        { ...running, NetworkSettings: { ...running.NetworkSettings, Ports: { '9944/tcp': [] } } },
        expected,
      ),
    /ports are not live/,
  );
  assert.throws(
    () =>
      nativeRunningContainer(
        { ...running, NetworkSettings: { ...running.NetworkSettings, Networks: {} } },
        expected,
      ),
    /detached/,
  );
  assert.throws(() => nativeRunningContainer({ ...running, Id: 'ff'.repeat(32) }, expected));
  assert.throws(
    () =>
      nativeRunningContainer(
        {
          ...running,
          NetworkSettings: {
            ...running.NetworkSettings,
            Ports: {
              ...running.NetworkSettings.Ports,
              '30333/tcp': [{ HostIp: '127.0.0.1', HostPort: '30333' }],
            },
          },
        },
        expected,
      ),
    /ports are not live/,
  );
});

test('native entry requires explicit localnet opt-in and fresh private consumer child output', () => {
  const base = mkdtempSync(join(tmpdir(), 'published-native-guards-'));
  try {
    const consumer = join(base, 'consumer'),
      keys = join(base, 'keys');
    mkdirSync(consumer);
    mkdirSync(keys);
    /** @type {NodeJS.ProcessEnv} */ const env = {
      IN_NIX_SHELL: '1',
      PASSPORT_HOST_NATIVE: '1',
      PASSPORT_RC_LOCALNET: '1',
      MN_NETWORK_ID: 'undeployed',
      CONSUMER_ROOT: consumer,
      PASSPORT_HOST_NATIVE_ROOT: join(consumer, 'native-test'),
      PASSPORT_KEY_DIR: keys,
    };
    assert.equal(nativeScope(env).output, join(realpathSync(consumer), 'native-test'));
    /** @type {Array<(e:NodeJS.ProcessEnv)=>void>} */ const changes = [
      (e) => {
        delete e.PASSPORT_HOST_NATIVE;
      },
      (e) => {
        e.MN_NETWORK_ID = 'mainnet';
      },
      (e) => {
        e.PASSPORT_SPONSOR_SEED = 'user-secret';
      },
      (e) => {
        e.PASSPORT_HOST_NATIVE_ROOT = join(base, 'native-not-child');
      },
    ];
    for (const change of changes) {
      const altered = { ...env };
      change(altered);
      assert.throws(() => nativeScope(altered));
    }
    const sensitive = { ...env, PASSPORT_SPONSOR_SEED: 'fixture-secret-never-print' };
    assert.throws(
      () => nativeScope(sensitive),
      (error) => {
        assert.ok(!inspect(error).includes('fixture-secret-never-print'));
        return true;
      },
    );
    mkdirSync(join(consumer, 'native-test'));
    writeFileSync(join(consumer, 'native-test', 'retained'), 'unknown');
    assert.throws(() => nativeScope(env), /Retain completed, failed and uncertain/);
    env.PASSPORT_HOST_NATIVE_ROOT = join(consumer, 'native-new');
    const linked = join(base, 'linked-keys');
    symlinkSync(keys, linked);
    env.PASSPORT_KEY_DIR = linked;
    assert.throws(() => nativeScope(env));
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
function result() {
  return {
    kind: 'published-host-native-orchestration',
    testsPassed: 14,
    cases: Array.from({ length: 14 }, (_, i) => 'native ' + i),
    keyOriginDerivationMatched: true,
    nativeProof: true,
    hostPublicModule: true,
    sdkReadOnly: true,
    syntheticCredentials: true,
    hostSignerHandlers: false,
    signerPage: false,
    realProvider: false,
    fullCompatibility: false,
    address: 'ab'.repeat(32),
    grantId: 'cd'.repeat(32),
    depositTxId: '00' + 'ef'.repeat(32),
    depositTxHash: '12'.repeat(32),
    confirmedContractActions: ['12'.repeat(32)],
    holding: { value: '7', color: '00'.repeat(32) },
    proofs: [{ keyLocation: 'keys/deposit_shielded', bytes: 10 }],
    sponsorships: 1,
    draws: { owner: 1, grantee: 1, creations: 0 },
  };
}
test('native receipt distinguishes a 33-byte v9 intent identifier from a transaction hash', () => {
  const good = result();
  nativeResult(good);
  assert.throws(() => nativeResult({ ...good, depositTxId: 'ef'.repeat(32) }));
  assert.throws(() => nativeResult({ ...good, depositTxId: '01' + 'ef'.repeat(32) }));
  assert.throws(() => nativeResult({ ...good, depositTxHash: good.depositTxId }));
});

test('native acceptance refuses a missing proof, provider/full-compatibility claim or skipped case', () => {
  nativeResult(result());
  /** @type {Array<(r:ReturnType<typeof result>)=>void>} */ const changes = [
    (r) => {
      r.nativeProof = false;
    },
    (r) => {
      r.realProvider = true;
    },
    (r) => {
      r.fullCompatibility = true;
    },
    (r) => {
      r.testsPassed = 0;
    },
    (r) => {
      r.cases.pop();
    },
    (r) => {
      assert.ok(r.cases[0]);
      r.cases[13] = r.cases[0];
    },
    (r) => {
      r.proofs = [];
    },
    (r) => {
      r.confirmedContractActions = [];
    },
    (r) => {
      r.holding.value = '0';
    },
    (r) => {
      r.draws.creations = 1;
    },
  ];
  for (const change of changes) {
    const altered = result();
    change(altered);
    assert.throws(() => nativeResult(altered));
  }
});
function finalityFixture() {
  const account = 'ab'.repeat(32),
    txHash = 'cd'.repeat(32),
    blockHash = 'ef'.repeat(32);
  const row = {
    hash: txHash,
    block: { hash: blockHash, height: 10 },
    contractActions: [{ address: account }],
    transactionResult: { status: 'SUCCESS', segments: [{ id: 1, success: true }] },
  };
  let canonical = '0x' + blockHash;
  /** @type {typeof fetch} */ const request = async (_url, init) => {
    assert.ok(typeof init?.body === 'string');
    const data = JSON.parse(init.body);
    return new Response(
      JSON.stringify(
        data.method === 'chain_getBlockHash'
          ? { jsonrpc: '2.0', id: 1, result: canonical }
          : { data: { transactions: [row] } },
      ),
      { status: 200 },
    );
  };
  const readiness = async () => ({
    ready: true,
    finalizedHeight: 11,
    finalizedHash: '34'.repeat(32),
    timestamp: Date.now(),
    lagMs: 1,
  });
  return {
    account,
    txHash,
    blockHash,
    row,
    request,
    readiness,
    setCanonical: (/** @type {string} */ value) => {
      canonical = value;
    },
  };
}
test('native finality independently verifies success, ACC membership and canonical finalized blocks', async () => {
  const f = finalityFixture();
  const r = await nativeFinality(f.account, [f.txHash], {
    fetch: f.request,
    readiness: f.readiness,
  });
  assert.deepEqual(r.transactions, [{ txHash: f.txHash, blockHeight: 10, blockHash: f.blockHash }]);
  f.setCanonical('0x' + '00'.repeat(32));
  await assert.rejects(() =>
    nativeFinality(f.account, [f.txHash], { fetch: f.request, readiness: f.readiness }),
  );
});
test('partial success, contradictory segments, foreign ACC and duplicate hashes cannot qualify', async () => {
  /** @type {Array<(f:ReturnType<typeof finalityFixture>)=>void>} */ const changes = [
    (f) => {
      f.row.transactionResult.status = 'PARTIAL_SUCCESS';
    },
    (f) => {
      assert.ok(f.row.transactionResult.segments[0]);
      f.row.transactionResult.segments[0].success = false;
    },
    (f) => {
      assert.ok(f.row.contractActions[0]);
      f.row.contractActions[0].address = '00'.repeat(32);
    },
  ];
  for (const change of changes) {
    const f = finalityFixture();
    change(f);
    await assert.rejects(() =>
      nativeFinality(f.account, [f.txHash], { fetch: f.request, readiness: f.readiness }),
    );
  }
  const f = finalityFixture();
  await assert.rejects(() =>
    nativeFinality(f.account, [f.txHash, f.txHash], { fetch: f.request, readiness: f.readiness }),
  );
});

test('hosted native acceptance cannot relabel the read-only baseline or claim reader delivery', () => {
  assert.throws(() => nativeResult(result(), 'hosted-authorising'));
  const hosted = {
    ...result(),
    kind: 'published-hosted-signer-native',
    testsPassed: 20,
    cases: Array.from({ length: 20 }, (_, i) => 'hosted ' + i),
    sdkReadOnly: false,
    hostSignerHandlers: true,
    authorisingOnly: true,
    readerDelivery: false,
    proofs: [{ keyLocation: 'keys/add_device_with_jubjub', bytes: 10 }],
  };
  nativeResult(hosted, 'hosted-authorising');
  assert.throws(() => nativeResult(hosted));
  assert.throws(() => nativeResult({ ...hosted, readerDelivery: true }, 'hosted-authorising'));
  assert.throws(() => nativeResult({ ...hosted, proofs: result().proofs }, 'hosted-authorising'));
});

test('public native evidence drops unknown child fields and hashes filesystem locations', async () => {
  const { publicSignerIdentity, publicNativeResult, nativeEndIdentity } =
    await import('../scripts/qualification/native-public-receipt.mjs');
  const child = {
    ...result(),
    secret: 'never-export',
    privatePath: '/private/user/root',
    cases: ['private-case-label'],
  };
  const projected = publicNativeResult(child);
  const signer = publicSignerIdentity({ root: '/private/user/root', sha256: 'ab'.repeat(32) });
  const text = JSON.stringify({ projected, signer });
  for (const raw of ['never-export', '/private/user/root', 'private-case-label'])
    assert.equal(text.includes(raw), false);
  assert.ok(projected && signer);
  assert.equal(projected.depositTxId, child.depositTxId);
  assert.match(signer.preparedRootPathSha256, /^[a-f0-9]{64}$/);
  assert.throws(() => publicNativeResult({ ...child, address: '/private/user/root' }));
  const failed = await nativeEndIdentity(async () => {
    throw Error('/private/end-identity');
  });
  assert.ok(failed.failureSha256);
  assert.match(failed.failureSha256, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(failed).includes('/private'), false);
  assert.deepEqual(await nativeEndIdentity(async () => ({ commit: 'test' })), {
    source: { commit: 'test' },
  });
});

test('native parent identity is accepted by actual worker schema before any runtime activity', async () => {
  const { nativeWorkerInputIdentity, nativeWorkerConfiguration } =
    await import('../scripts/qualification/native-worker-inputs.mjs');
  const keys = '/private/test-keys',
    signer = { root: '/private/test-signer', sha256: 'ab'.repeat(32) };
  /** @param {string} profile @param {{root:string,sha256:string}|undefined} signer */
  const make = (profile, signer) =>
    JSON.parse(
      JSON.stringify({
        kind: 'published-host-native-inputs',
        profile,
        ...nativeWorkerInputIdentity({ keys, signer }),
      }),
    );
  const publicInput = make('public-module', undefined);
  assert.deepEqual(nativeWorkerConfiguration(publicInput, { PASSPORT_KEY_DIR: keys }), {
    keyDir: keys,
    signerRoot: undefined,
  });
  const hostedInput = make('hosted-authorising', signer);
  const env = {
    PASSPORT_KEY_DIR: keys,
    PASSPORT_SIGNER_ROOT: signer.root,
    PASSPORT_SIGNER_SHA256: signer.sha256,
  };
  assert.deepEqual(nativeWorkerConfiguration(hostedInput, env), {
    keyDir: keys,
    signerRoot: signer.root,
  });
  assert.equal(JSON.stringify(hostedInput).includes('/private'), false);
  for (const changed of [
    { ...env, PASSPORT_KEY_DIR: '/private/other' },
    { ...env, PASSPORT_SIGNER_ROOT: '/private/other' },
    { ...env, PASSPORT_SIGNER_SHA256: 'cd'.repeat(32) },
  ])
    assert.throws(() => nativeWorkerConfiguration(hostedInput, changed));
  const { keyDirectoryPathSha256: legacy, ...missing } = hostedInput;
  assert.throws(() => nativeWorkerConfiguration({ ...missing, keyDirSha256: legacy }, env));
});
