#!/usr/bin/env node
// Opt-in public-package/native qualification. It controls only the retained dedicated project.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  realpathSync,
  statfsSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyRetainedHostConsumer } from './consumer/host-retained.mjs';
import { consumerSha256 } from './consumer-inputs.mjs';
import { workspaceIdentity, verifyQualificationBinding } from './qualification/receipt.mjs';
import { dedicatedIndexerReadiness } from './qualification/indexer-readiness.mjs';
import { verifyPublicSigner } from './consumer/public-signer-source.mjs';
import { nativeLeasePath } from './qualification/native-lease.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const PROJECT = 'mn-passport-qual-20261023';
const names = ['node', 'proof-server', 'indexer'].map((service) => `${PROJECT}-${service}-1`);
/** @param {string[]} args */
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
/** @param {any} c @param {string} name */
export function nativeContainer(c, name) {
  const service = name.slice(PROJECT.length + 1, -2);
  assert.ok(names.includes(name));
  assert.equal(c.Name, '/' + name);
  assert.equal(c.Config.Labels['com.docker.compose.project'], PROJECT);
  assert.equal(c.Config.Labels['com.docker.compose.service'], service);
  assert.match(c.Id, /^[a-f0-9]{64}$/);
  assert.match(c.Image, /^sha256:[a-f0-9]{64}$/);
  assert.equal(typeof c.State.Running, 'boolean');
  assert.equal(Object.keys(c.HostConfig.PortBindings).length, 1);
  /** @type {Record<string,[string,string]>} */ const ports = {
    node: ['9944/tcp', '19954'],
    'proof-server': ['6300/tcp', '16310'],
    indexer: ['8088/tcp', '18098'],
  };
  const pair = ports[service];
  assert.ok(pair);
  const [internal, external] = pair;
  assert.deepEqual(c.HostConfig.PortBindings[internal], [
    { HostIp: '127.0.0.1', HostPort: external },
  ]);
  assert.ok(
    c.Mounts.every(
      (/** @type {any} */ m) => m.Type === 'volume' && m.Name.startsWith(PROJECT + '_'),
    ),
  );
  return {
    name,
    id: c.Id,
    image: c.Image,
    initiallyRunning: c.State.Running,
    mounts: c.Mounts.map((/** @type {any} */ m) => ({ name: m.Name, destination: m.Destination })),
    ports: c.HostConfig.PortBindings,
  };
}
/** Conservative readiness: leave room for a maximum normal extrinsic after mandatory work.
 * This is a precondition, not a guarantee of inclusion in a future block.
 * @param {{maxBlock:string,maxNormal:string,baseExtrinsic:string,mandatory:string,operational:string}} values
 */
export function nativeBlockCapacity(values) {
  /** @param {string} value */
  const number = (value) => {
    assert.match(value, /^(0|[1-9][0-9]*)$/);
    return BigInt(value);
  };
  const maxBlock = number(values.maxBlock),
    maxNormal = number(values.maxNormal),
    baseExtrinsic = number(values.baseExtrinsic),
    mandatory = number(values.mandatory),
    operational = number(values.operational);
  assert.ok(maxBlock > 0n && maxNormal > 0n && maxNormal + baseExtrinsic <= maxBlock);
  return mandatory + operational + maxNormal + baseExtrinsic <= maxBlock;
}
/** @param {NodeJS.ProcessEnv} env */
export function nativeScope(env) {
  assert.equal(env.IN_NIX_SHELL !== undefined, true, 'Use the pinned Nix shell');
  assert.equal(env.PASSPORT_HOST_NATIVE, '1', 'Explicit native opt-in is required');
  assert.equal(env.PASSPORT_RC_LOCALNET, '1');
  assert.equal(env.MN_NETWORK_ID, 'undeployed');
  for (const name of ['PASSPORT_SPONSOR_SEED', 'PASSPORT_SPONSOR_SEED_FILE'])
    assert.ok(env[name] === undefined, 'User sponsor seeds must not enter this fixture');
  const consumer = realpathSync(env.CONSUMER_ROOT ?? '');
  assert.ok(
    consumer !== ROOT && !consumer.startsWith(ROOT + '/') && !ROOT.startsWith(consumer + '/'),
    'Consumer must be outside the SDK checkout',
  );
  const output = env.PASSPORT_HOST_NATIVE_ROOT ?? '',
    keys = env.PASSPORT_KEY_DIR ?? '';
  assert.ok(isAbsolute(output) && isAbsolute(keys));
  assert.equal(
    realpathSync(dirname(output)),
    consumer,
    'Native output must be a fresh direct child of the audited consumer',
  );
  assert.match(basename(output), /^native-[a-z0-9-]+$/);
  assert.equal(existsSync(output), false, 'Retain completed, failed and uncertain native runs');
  assert.equal(lstatSync(keys).isSymbolicLink(), false);
  assert.equal(lstatSync(keys).isDirectory(), true);
  return { consumer, output: join(consumer, basename(output)), keys: realpathSync(keys) };
}
/** @param {any} result */
export function nativeResult(result, profile = 'public-module') {
  assert.ok(['public-module', 'hosted-authorising'].includes(profile));
  const hosted = profile === 'hosted-authorising';
  assert.equal(
    result.kind,
    hosted ? 'published-hosted-signer-native' : 'published-host-native-orchestration',
  );
  const count = hosted ? 20 : 14;
  assert.equal(result.testsPassed, count);
  assert.equal(result.cases.length, count);
  assert.equal(new Set(result.cases).size, count);
  if (hosted) {
    assert.equal(result.authorisingOnly, true);
    assert.equal(result.readerDelivery, false);
    assert.ok(
      result.proofs.some(
        (/** @type {any} */ p) =>
          p.keyLocation === 'keys/add_device_with_jubjub' ||
          p.keyLocation.split('?')[0]?.endsWith('/add_device_with_jubjub'),
      ),
      'Hosted native result must include the SDK add-device proof',
    );
  }
  assert.equal(result.keyOriginDerivationMatched, true);
  assert.equal(result.nativeProof, true);
  assert.equal(result.hostPublicModule, true);
  assert.equal(result.sdkReadOnly, !hosted);
  assert.equal(result.hostSignerHandlers, hosted);
  assert.equal(result.syntheticCredentials, true);
  for (const key of ['signerPage', 'realProvider', 'fullCompatibility'])
    assert.equal(result[key], false);
  assert.match(result.address, /^[a-f0-9]{64}$/);
  assert.match(result.grantId, /^[a-f0-9]{64}$/);
  assert.match(result.depositTxId, /^00[a-f0-9]{64}$/);
  assert.match(result.depositTxHash, /^[a-f0-9]{64}$/);
  assert.ok(result.confirmedContractActions.includes(result.depositTxHash));
  assert.equal(
    new Set(result.confirmedContractActions).size,
    result.confirmedContractActions.length,
  );
  assert.ok(
    result.confirmedContractActions.every((/** @type {string} */ h) => /^[a-f0-9]{64}$/.test(h)),
  );
  assert.equal(result.holding.value, '7');
  assert.equal(result.holding.color, '00'.repeat(32));
  assert.ok(result.proofs.length > 0 && result.sponsorships > 0);
  assert.equal(result.draws.creations, 0);
  assert.ok(result.draws.owner > 0 && result.draws.grantee > 0);
}
/** Independently bind every observed contract action to successful canonical finalized blocks.
 * @param {string} account @param {string[]} hashes
 * @param {{fetch?:typeof fetch,readiness?:typeof dedicatedIndexerReadiness}} [options]
 */
export async function nativeFinality(account, hashes, options = {}) {
  const request = options.fetch ?? fetch,
    readiness = options.readiness ?? dedicatedIndexerReadiness;
  assert.match(account, /^[a-f0-9]{64}$/);
  assert.ok(hashes.length > 0);
  assert.equal(new Set(hashes).size, hashes.length);
  for (const hash of hashes) assert.match(hash, /^[a-f0-9]{64}$/);
  const post = async (/** @type {string} */ url, /** @type {unknown} */ body) => {
    const response = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.ok, true);
    const value = await response.json();
    assert.ok(
      value && typeof value === 'object' && !Array.isArray(value),
      'Malformed native qualification response',
    );
    return /** @type {Record<string,any>} */ (value);
  };
  const rows = await Promise.all(
    hashes.map(async (hash) => {
      const body = await post('http://127.0.0.1:18098/api/v4/graphql', {
        query:
          'query($offset:TransactionOffset!){transactions(offset:$offset){hash block{hash height} contractActions{address} ... on RegularTransaction{transactionResult{status segments{id success}}}}}',
        variables: { offset: { hash } },
      });
      assert.ok(!body.errors && Array.isArray(body.data?.transactions));
      const matching = body.data.transactions.filter((/** @type {any} */ r) => r.hash === hash);
      assert.equal(matching.length, 1);
      const row = matching[0];
      assert.equal(row.transactionResult?.status, 'SUCCESS');
      assert.ok(
        row.transactionResult.segments == null ||
          (Array.isArray(row.transactionResult.segments) &&
            row.transactionResult.segments.every((/** @type {any} */ s) => s.success === true)),
      );
      assert.ok(row.contractActions?.some((/** @type {any} */ a) => a.address === account));
      assert.match(row.block.hash, /^[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(row.block.height) && row.block.height >= 1);
      return { txHash: hash, blockHeight: row.block.height, blockHash: row.block.hash };
    }),
  );
  const deadline = Date.now() + 120000;
  for (;;) {
    const tip = await readiness();
    const height = tip.finalizedHeight;
    if (tip.ready && typeof height === 'number' && rows.every((row) => row.blockHeight <= height)) {
      for (const row of rows) {
        const response = await post('http://127.0.0.1:19954', {
          jsonrpc: '2.0',
          id: 1,
          method: 'chain_getBlockHash',
          params: [row.blockHeight],
        });
        assert.equal(response.error, undefined);
        assert.equal(response.result, '0x' + row.blockHash);
      }
      return {
        finalizedHeight: tip.finalizedHeight,
        finalizedHash: tip.finalizedHash,
        transactions: rows,
      };
    }
    assert.ok(Date.now() < deadline, 'Native actions have not reached canonical finality');
    await delay(1000);
  }
}

export async function runNativeHost(profile = 'public-module') {
  assert.ok(['public-module', 'hosted-authorising'].includes(profile));
  const signer =
    profile === 'hosted-authorising'
      ? {
          root: process.env.PASSPORT_SIGNER_ROOT ?? '',
          sha256: process.env.PASSPORT_SIGNER_SHA256 ?? '',
        }
      : undefined;
  const signerInput = signer ? verifyPublicSigner(signer.root, signer.sha256, ROOT) : undefined;
  const { consumer, output, keys } = nativeScope(process.env),
    pin = process.env.CONSUMER_CONFIG_SHA256 ?? '';
  if (signerInput) {
    assert.equal(realpathSync(signerInput.consumer.root), consumer);
    assert.equal(signerInput.consumer.configSha256, pin);
  }
  const initial = await workspaceIdentity(ROOT);
  assert.equal(initial.dirty, false, 'Commit and sign source before native execution');
  const config = verifyRetainedHostConsumer(consumer, pin, ROOT);
  assert.equal(config.version, '0.1.0-rc6');
  assert.equal(config.pin.version, '0.1.2-canary.2');
  const binding = await verifyQualificationBinding(ROOT);
  const disk = statfsSync(dirname(output));
  assert.ok(disk.bavail * disk.bsize >= 15 * 1024 ** 3);
  assert.ok(Number(docker(['info', '--format', '{{.MemTotal}}'])) >= 24 * 1024 ** 3);
  mkdirSync(output, { mode: 0o700 });
  const startedAt = Date.now();
  /** @type {any[]} */ const started = [];
  /** @type {Array<{id:string,stopped:boolean}>} */ const cleanup = [];
  /** @type {import('node:child_process').ChildProcess|undefined} */ let active;
  let interrupted = false,
    verdict = 'failed';
  /** @type {string|undefined} */ let failure;
  /** @type {any[]|undefined} */ let scope;
  /** @type {any} */ let inner, finality;
  /** @type {Record<string,string>|undefined} */ let compiled;
  const leasePath = nativeLeasePath();
  const leaseBody =
    JSON.stringify({
      pid: process.pid,
      source: initial.commit,
      outputSha256: consumerSha256(output),
    }) + '\n';
  let leaseOwned = false;
  /** @type {ReturnType<typeof setTimeout>|undefined} */ let interruptKiller;
  const interrupt = () => {
    interrupted = true;
    if (active?.pid) {
      const pid = active.pid;
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {}
      clearTimeout(interruptKiller);
      interruptKiller = setTimeout(() => {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {}
      }, 3000);
      interruptKiller.unref();
    }
  };
  process.on('SIGTERM', interrupt);
  process.on('SIGINT', interrupt);
  /** @type {NodeJS.ProcessEnv} */ const env = {
    ...process.env,
    PASSPORT_NATIVE_CHILD: '1',
    PASSPORT_NATIVE_PROFILE: profile,
    PASSPORT_NATIVE_SDK_ROOT: ROOT,
    PASSPORT_KEY_DIR: keys,
    MN_NETWORK_ID: 'undeployed',
  };
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_TEST_CONTEXT']) delete env[key];
  /** @param {string[]} args @param {string} file @param {number} timeout */
  async function command(args, file, timeout) {
    assert.equal(interrupted, false, 'Native qualification interrupted');
    const fd = openSync(join(output, file), 'wx', 0o600);
    /** @type {ReturnType<typeof setTimeout>|undefined} */ let timer, killer;
    try {
      const child = spawn(process.execPath, args, {
        cwd: output,
        env,
        detached: true,
        stdio: ['ignore', fd, fd],
      });
      active = child;
      timer = setTimeout(() => {
        if (child.pid)
          try {
            process.kill(-child.pid, 'SIGTERM');
          } catch {}
        killer = setTimeout(() => {
          if (child.pid)
            try {
              process.kill(-child.pid, 'SIGKILL');
            } catch {}
        }, 3000);
      }, timeout);
      const exit = await new Promise((res, rej) => {
        child.once('error', rej);
        child.once('exit', (code, signal) => res({ code, signal }));
      });
      assert.equal(exit.code, 0, 'Native command failed; retain its private log and fixture');
      assert.equal(interrupted, false, 'Native qualification interrupted');
    } finally {
      clearTimeout(timer);
      clearTimeout(killer);
      closeSync(fd);
      clearTimeout(interruptKiller);
      active = undefined;
    }
  }
  try {
    writeFileSync(leasePath, leaseBody, { flag: 'wx', mode: 0o600 });
    leaseOwned = true;
    /** @type {Array<[string,string]>} */ const copies = [
      ['tests/fixtures/published-native-host.ts', 'native-core.ts'],
      ['tests/fixtures/published-native-host-bootstrap.js', 'bootstrap.mjs'],
      ['docs/examples/jubjub-grant-scope.ts', 'jubjub-grant-scope.ts'],
    ];
    if (signer)
      copies.push(
        ['tests/fixtures/published-native-host.ts', 'native-baseline.ts'],
        ['tests/fixtures/public-signer-harness.js', 'public-signer-harness.js'],
        ['scripts/qualification/signer-windows.mjs', 'signer-windows.mjs'],
      );
    if (signer) copies[0] = ['tests/fixtures/public-signer-native.ts', 'native-core.ts'];
    for (const [source, target] of copies) copyFileSync(join(ROOT, source), join(output, target));
    const sourceInputs = Object.fromEntries(
      copies.map(([, file]) => [file, consumerSha256(readFileSync(join(output, file)))]),
    );
    writeFileSync(
      join(output, 'native-inputs.json'),
      JSON.stringify(
        {
          kind: 'published-host-native-inputs',
          profile,
          signer,
          source: initial,
          sourceInputs,
          configSha256: pin,
          keyDirSha256: consumerSha256(keys),
          compilerManifestSha256: binding.compilerManifestSha256,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
    await command(
      [
        join(consumer, 'node_modules/typescript/bin/tsc'),
        '--strict',
        '--skipLibCheck',
        '--target',
        'ES2022',
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        '--outDir',
        join(output, 'compiled'),
        join(output, 'native-core.ts'),
      ],
      'typecheck.private.log',
      120000,
    );
    compiled = Object.fromEntries(
      ['native-core.js', 'jubjub-grant-scope.js', ...(signer ? ['native-baseline.js'] : [])].map(
        (file) => [file, consumerSha256(readFileSync(join(output, 'compiled', file)))],
      ),
    );
    verifyRetainedHostConsumer(consumer, pin, ROOT);
    assert.deepEqual(await workspaceIdentity(ROOT), initial);
    scope = JSON.parse(docker(['inspect', ...names])).map(
      (/** @type {any} */ c, /** @type {number} */ i) =>
        nativeContainer(c, /** @type {string} */ (names[i])),
    );
    assert.ok(
      scope?.every((c) => !c.initiallyRunning),
      'The dedicated stack is already running; do not share an active genesis wallet',
    );
    writeFileSync(join(output, 'containers-before.json'), JSON.stringify(scope, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    for (const c of scope ?? [])
      if (!c.initiallyRunning) {
        assert.equal(interrupted, false, 'Native qualification interrupted');
        started.push(c);
        docker(['start', c.id]);
      }
    const deadline = Date.now() + 10 * 60000;
    while (!(await dedicatedIndexerReadiness()).ready) {
      assert.equal(interrupted, false);
      assert.ok(Date.now() < deadline, 'Indexer is not on the live finalized node chain');
      await delay(1000);
    }
    const health = await fetch('http://127.0.0.1:16310/health', {
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(health.ok, true);
    await command([join(output, 'bootstrap.mjs')], 'native-worker.private.log', 60 * 60000);
    inner = JSON.parse(readFileSync(join(output, 'native-result.json'), 'utf8'));
    nativeResult(inner, profile);
    if (signer) verifyPublicSigner(signer.root, signer.sha256, ROOT);
    finality = await nativeFinality(inner.address, inner.confirmedContractActions);
    assert.equal(interrupted, false, 'Native qualification interrupted');
    for (const [file, hash] of Object.entries(sourceInputs))
      assert.equal(consumerSha256(readFileSync(join(output, file))), hash);
    for (const [file, hash] of Object.entries(compiled))
      assert.equal(consumerSha256(readFileSync(join(output, 'compiled', file))), hash);
    verifyRetainedHostConsumer(consumer, pin, ROOT);
    assert.deepEqual(await workspaceIdentity(ROOT), initial);
    verdict = 'passed';
  } catch (error) {
    failure = consumerSha256(String(error));
    writeFileSync(join(output, 'parent-failure.private.log'), String(error) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  } finally {
    for (const c of [...started].reverse()) {
      try {
        const current = JSON.parse(docker(['inspect', c.id]))[0];
        const owned = nativeContainer(current, c.name);
        assert.equal(owned.id, c.id);
        assert.equal(owned.image, c.image);
        assert.deepEqual(owned.mounts, c.mounts);
        assert.deepEqual(owned.ports, c.ports);
        docker(['stop', '--time', '20', c.id]);
        assert.equal(JSON.parse(docker(['inspect', c.id]))[0].State.Running, false);
        cleanup.push({ id: c.id, stopped: true });
      } catch (error) {
        verdict = 'failed';
        cleanup.push({ id: c.id, stopped: false });
        failure ??= consumerSha256(String(error));
      }
    }
    if (leaseOwned && cleanup.every((c) => c.stopped)) {
      try {
        assert.equal(readFileSync(leasePath, 'utf8'), leaseBody);
        unlinkSync(leasePath);
      } catch (error) {
        verdict = 'failed';
        failure ??= consumerSha256(String(error));
      }
    }
    clearTimeout(interruptKiller);
    process.off('SIGTERM', interrupt);
    process.off('SIGINT', interrupt);
  }
  const end = await workspaceIdentity(ROOT);
  if (interrupted || JSON.stringify(end) !== JSON.stringify(initial)) verdict = 'failed';
  const publication = JSON.parse(
    readFileSync(join(consumer, 'bundle/publication-receipt.json'), 'utf8'),
  );
  assert.match(publication.source.commit, /^[a-f0-9]{40}$/);
  const receipt = {
    runtime: { node: process.version, platform: process.platform, arch: process.arch },
    publishedSdkSource: publication.source.commit,
    schemaVersion: 1,
    kind: signer ? 'verified-public-signer-native' : 'verified-published-host-native',
    signer,
    profile,
    outcome: verdict,
    source: initial,
    endSource: end,
    binding,
    consumer: {
      sdkVersion: config.version,
      hostVersion: config.pin.version,
      hostArchiveSha256: config.pin.sha256,
      configSha256: pin,
      lockSha256: config.lockSha256,
      publicationReceiptSha256: config.receiptSha256,
      installedTree: config.installedTree,
    },
    compiled,
    containers: scope,
    cleanup,
    elapsedMs: Date.now() - startedAt,
    inner,
    finality,
    failureSha256: failure,
    releaseQualified: false,
    realProvider: false,
    fullCompatibility: false,
  };
  writeFileSync(
    join(output, 'native-parent-receipt.json'),
    JSON.stringify(receipt, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  console.log(JSON.stringify(receipt, null, 2));
  if (verdict !== 'passed')
    throw Error('Native qualification failed; preserve its private output root');
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename)
  await runNativeHost(process.argv[2] ?? 'public-module');
