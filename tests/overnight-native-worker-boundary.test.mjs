import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ISOLATION_FORBIDDEN_NAMES,
  ISOLATION_FORBIDDEN_PREFIXES,
  isolationProfile,
  isolationEnvironment,
} from '../scripts/qualification/native-isolation-profile.mjs';
import { nativeIsolationWorker } from '../scripts/qualification/native-isolation-worker.mjs';

/** Only synthetic public descriptors and opaque fixture placeholders are written.
 * @param {import('node:test').TestContext} t @param {'p256'|'jubjub'} [arm]
 */
function fixture(t, arm = 'p256') {
  const output = realpathSync(
    mkdtempSync(join(realpathSync(tmpdir()), 'passport-worker-boundary-')),
  );
  t.after(() => rmSync(output, { recursive: true, force: true }));
  chmodSync(output, 0o700);
  const contract = join(output, 'reference');
  mkdirSync(contract, { mode: 0o700 });
  const profile = isolationProfile('1234567890abcdef', output);
  const descriptor = join(output, 'isolation.json');
  writeFileSync(descriptor, JSON.stringify(profile), { mode: 0o600, flag: 'wx' });
  const root = join(output, arm);
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...isolationEnvironment(profile),
    PASSPORT_LIVE_ROOT: output,
    PASSPORT_RC_LOCALNET: '1',
    MN_NETWORK_ID: 'undeployed',
    MIDNIGHT_NETWORK: 'local',
    PASSPORT_LIVE_HOST_JOBS: '1',
    PASSPORT_LIVE_PROFILE: 'lifecycle',
    PASSPORT_CONTRACT_DIR: contract,
    PASSPORT_REGISTRY_FILE: join(root, 'registry.json'),
  };
  /** @param {string} path @param {string|Buffer} [bytes] */
  const write = (path, bytes = 'synthetic opaque placeholder') =>
    writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' });
  const owner = () => {
    mkdirSync(root, { mode: 0o700 });
    write(join(root, 'fixture.json'));
  };
  /** @param {'wallet-transfer'|'wallet-reconnect'} kind */
  const wallet = (kind) => {
    owner();
    const walletRoot = join(root, 'wallet');
    mkdirSync(walletRoot, { mode: 0o700 });
    env.PASSPORT_REGISTRY_FILE = join(walletRoot, 'registry.json');
    if (kind === 'wallet-reconnect') env.PASSPORT_WALLET_OWNER_FIXTURE = join(root, 'fixture.json');
    else write(join(walletRoot, 'wallet-ready.json'));
    return {
      kind,
      root: walletRoot,
      arm,
      env,
      mode: kind === 'wallet-transfer' ? 'wallet-producer' : 'wallet-observer',
    };
  };
  return {
    output,
    root,
    descriptor,
    profile,
    env,
    write,
    owner,
    wallet,
    request: { kind: 'live', mode: 'prepare', root, arm, operation: 'create', fault: 'none', env },
  };
}

/** @param {ReturnType<typeof fixture>} f
 * @returns {import('../scripts/qualification/native-isolation-worker.mjs').WorkerAdmission} */
function liveRequest(f) {
  return { ...f.request, kind: 'live' };
}

for (const arm of ['p256', 'jubjub']) {
  test(`isolated ${arm} prepare admits exact immutable descriptor without creating worker paths`, (t) => {
    assert.ok(arm === 'p256' || arm === 'jubjub');
    const f = fixture(t, arm),
      before = readFileSync(f.descriptor);
    const admitted = nativeIsolationWorker(liveRequest(f));
    assert.deepEqual(admitted, f.profile);
    assert.ok(Object.isFrozen(admitted) && Object.isFrozen(admitted.endpoints));
    assert.equal(existsSync(f.root), false);
    assert.deepEqual(readFileSync(f.descriptor), before);
    assert.deepEqual(readdirSync(f.output).sort(), ['isolation.json', 'reference']);
  });
}

test('no isolation marker selects legacy guards without reading or creating a path', () => {
  assert.equal(
    nativeIsolationWorker({ kind: 'live', root: '/does-not-exist/legacy', arm: 'legacy', env: {} }),
    undefined,
  );
});

test('every partial, empty, foreign or unknown marker refuses instead of selecting legacy', (t) => {
  const f = fixture(t);
  for (const name of Object.keys(isolationEnvironment(f.profile)).filter((name) =>
    name.startsWith('PASSPORT_NATIVE_ISOLATION'),
  )) {
    const request = { ...liveRequest(f), env: { [name]: f.env[name] } };
    assert.throws(() => nativeIsolationWorker(request));
  }
  for (const value of ['', 'legacy', 'source-host-job-combined'])
    assert.throws(() =>
      nativeIsolationWorker({
        ...liveRequest(f),
        env: { ...f.env, PASSPORT_NATIVE_ISOLATION: value },
      }),
    );
  assert.throws(() =>
    nativeIsolationWorker({
      ...liveRequest(f),
      env: { ...f.env, PASSPORT_NATIVE_ISOLATION_EXTRA: 'x' },
    }),
  );
  assert.equal(existsSync(f.root), false);
});

test('every admitted endpoint and identity marker is exact', (t) => {
  const f = fixture(t);
  for (const [name] of Object.entries(isolationEnvironment(f.profile))) {
    assert.throws(
      () => nativeIsolationWorker({ ...liveRequest(f), env: { ...f.env, [name]: 'different' } }),
      name,
    );
  }
  for (const name of [
    'PASSPORT_RC_LOCALNET',
    'MN_NETWORK_ID',
    'MIDNIGHT_NETWORK',
    'PASSPORT_LIVE_HOST_JOBS',
    'PASSPORT_LIVE_PROFILE',
  ]) {
    assert.throws(
      () => nativeIsolationWorker({ ...liveRequest(f), env: { ...f.env, [name]: 'different' } }),
      name,
    );
  }
  assert.equal(existsSync(f.root), false);
});

test('inherited seed, preload, search-path, image, dependency and alternate-port overrides refuse without echoing values', (t) => {
  const f = fixture(t),
    secret = 'DO_NOT_ECHO_SYNTHETIC_VALUE';
  const names = [
    ...ISOLATION_FORBIDDEN_NAMES,
    ...ISOLATION_FORBIDDEN_PREFIXES.map((prefix) => `${prefix}TEST`),
  ];
  for (const name of names) {
    assert.throws(
      () => nativeIsolationWorker({ ...liveRequest(f), env: { ...f.env, [name]: secret } }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.ok(error.message.includes(name));
        assert.equal(error.message.includes(secret), false);
        return true;
      },
    );
  }
  assert.equal(existsSync(f.root), false);
});

test('foreign root, registry, contract, arm, mode, operation and image fault refuse before setup', (t) => {
  const f = fixture(t),
    request = liveRequest(f);
  for (const patch of [
    { root: join(f.output, 'jubjub') },
    { root: `${f.root}/..` },
    { arm: 'other' },
    { mode: 'wallet-observer' },
    { operation: 'grant-issue' },
    { fault: 'image:add_device:after-submit' },
  ])
    assert.throws(() => nativeIsolationWorker({ ...request, ...patch }));
  for (const [name, value] of [
    ['PASSPORT_REGISTRY_FILE', join(f.output, 'registry.json')],
    ['PASSPORT_LIVE_ROOT', `${f.output}/..`],
    ['PASSPORT_CONTRACT_DIR', join(f.output, 'absent')],
    ['PASSPORT_WALLET_OWNER_FIXTURE', join(f.output, 'fixture.json')],
  ]) {
    assert.ok(name);
    assert.throws(() => nativeIsolationWorker({ ...request, env: { ...f.env, [name]: value } }));
  }
  assert.equal(existsSync(f.root), false);
});

test('descriptor closed schema refuses tampering even if the caller supplies its own digest marker', (t) => {
  const f = fixture(t);
  for (const value of [
    { ...f.profile, extra: true },
    { ...f.profile, project: 'retained-stack' },
    { ...f.profile, outputRoot: join(f.output, 'foreign') },
    { ...f.profile, endpoints: { ...f.profile.endpoints, nodeUrl: 'http://127.0.0.1:19954' } },
    { ...f.profile, service: { host: '127.0.0.1', port: 18797 } },
  ]) {
    const bytes = JSON.stringify(value);
    writeFileSync(f.descriptor, bytes);
    f.env.PASSPORT_NATIVE_ISOLATION_SHA256 = createHash('sha256').update(bytes).digest('hex');
    assert.throws(() => nativeIsolationWorker(liveRequest(f)));
  }
  writeFileSync(f.descriptor, '{');
  assert.throws(() => nativeIsolationWorker(liveRequest(f)));
  assert.equal(existsSync(f.root), false);
});

test('oversized, world-readable, linked and misplaced descriptors refuse without writes', async (t) => {
  for (const mutation of ['oversize', 'permissions', 'symlink', 'hardlink', 'misplaced']) {
    await t.test(mutation, (t) => {
      const f = fixture(t),
        request = liveRequest(f);
      if (mutation === 'oversize') writeFileSync(f.descriptor, Buffer.alloc(4097, 32));
      if (mutation === 'permissions') chmodSync(f.descriptor, 0o644);
      if (mutation === 'hardlink') linkSync(f.descriptor, join(f.output, 'alias.json'));
      if (mutation === 'symlink') {
        const bytes = readFileSync(f.descriptor);
        rmSync(f.descriptor);
        f.write(join(f.output, 'alias.json'), bytes);
        symlinkSync(join(f.output, 'alias.json'), f.descriptor);
      }
      if (mutation === 'misplaced')
        request.env = { ...f.env, PASSPORT_NATIVE_ISOLATION_FILE: join(f.output, 'alias.json') };
      assert.throws(() => nativeIsolationWorker(request));
      assert.equal(existsSync(f.root), false);
    });
  }
});

test('worker directory aliases and public modes refuse before fixture access', async (t) => {
  for (const mutation of ['symlink', 'permissions']) {
    await t.test(mutation, (t) => {
      const f = fixture(t);
      if (mutation === 'symlink') symlinkSync(join(f.output, 'reference'), f.root);
      else {
        mkdirSync(f.root, { mode: 0o700 });
        chmodSync(f.root, 0o755);
      }
      assert.throws(() => nativeIsolationWorker(liveRequest(f)));
      assert.equal(existsSync(join(f.root, 'fixture.json')), false);
    });
  }
});

test('live resume requires its original fixture and prepare cannot replace one', (t) => {
  const f = fixture(t),
    request = liveRequest(f);
  assert.throws(() => nativeIsolationWorker({ ...request, mode: 'resume' }));
  f.owner();
  const before = readFileSync(join(f.root, 'fixture.json'));
  assert.throws(() => nativeIsolationWorker(request));
  assert.deepEqual(nativeIsolationWorker({ ...request, mode: 'resume' }), f.profile);
  assert.deepEqual(readFileSync(join(f.root, 'fixture.json')), before);
});

test('existing fixture aliases, public permissions and oversized inputs refuse stat-only admission', async (t) => {
  for (const mutation of ['symlink', 'hardlink', 'permissions', 'oversize']) {
    await t.test(mutation, (t) => {
      const f = fixture(t);
      f.owner();
      const path = join(f.root, 'fixture.json');
      if (mutation === 'permissions') chmodSync(path, 0o644);
      if (mutation === 'oversize') writeFileSync(path, Buffer.alloc(65536));
      if (mutation === 'hardlink') linkSync(path, join(f.root, 'alias.json'));
      if (mutation === 'symlink') {
        rmSync(path);
        f.write(join(f.root, 'alias.json'));
        symlinkSync(join(f.root, 'alias.json'), path);
      }
      assert.throws(() => nativeIsolationWorker({ ...liveRequest(f), mode: 'host' }));
    });
  }
});

for (const kind of ['wallet-reconnect', 'wallet-transfer']) {
  test(`${kind} binds its exact arm, root, registry, mode and sibling owner`, (t) => {
    assert.ok(kind === 'wallet-reconnect' || kind === 'wallet-transfer');
    const f = fixture(t),
      request = f.wallet(kind),
      before = readFileSync(f.descriptor);
    assert.deepEqual(nativeIsolationWorker(request), f.profile);
    assert.throws(() => nativeIsolationWorker({ ...request, mode: 'prepare' }));
    assert.throws(() => nativeIsolationWorker({ ...request, root: f.root }));
    assert.throws(() => nativeIsolationWorker({ ...request, arm: 'jubjub' }));
    assert.throws(() =>
      nativeIsolationWorker({
        ...request,
        env: { ...f.env, PASSPORT_REGISTRY_FILE: join(f.root, 'registry.json') },
      }),
    );
    assert.throws(() =>
      nativeIsolationWorker({
        ...request,
        env: { ...f.env, PASSPORT_WALLET_OWNER_FIXTURE: join(f.output, 'jubjub', 'fixture.json') },
      }),
    );
    assert.deepEqual(readFileSync(f.descriptor), before);
    assert.equal(existsSync(join(request.root, 'wallet-fixture.json')), false);
  });
}

test('wallet reconnect refuses retained identity; payer requires observer readiness without mutating either', (t) => {
  const f = fixture(t),
    request = f.wallet('wallet-reconnect');
  const retained = join(request.root, 'wallet-fixture.json');
  f.write(retained);
  const before = readFileSync(retained);
  assert.throws(() => nativeIsolationWorker(request));
  assert.deepEqual(readFileSync(retained), before);
  const payerEnv = { ...f.env };
  delete payerEnv.PASSPORT_WALLET_OWNER_FIXTURE;
  /** @type {import('../scripts/qualification/native-isolation-worker.mjs').WorkerAdmission} */
  const payer = { ...request, kind: 'wallet-transfer', mode: 'wallet-producer', env: payerEnv };
  assert.throws(() => nativeIsolationWorker(payer));
  f.write(join(request.root, 'wallet-ready.json'));
  assert.deepEqual(nativeIsolationWorker(payer), f.profile);
  assert.deepEqual(readFileSync(retained), before);
  const transfer = join(request.root, 'wallet-transfer.json');
  f.write(transfer);
  const original = readFileSync(transfer);
  assert.throws(() => nativeIsolationWorker(payer));
  assert.deepEqual(readFileSync(transfer), original);
});
