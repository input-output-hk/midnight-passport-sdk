#!/usr/bin/env node
// Opt-in local candidate installs; never publishes or operates a live wallet/provider.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { auditInstalledBundle, packageArchive } from './consumer/installed-inputs.mjs';
import { validateInstalledCases } from './consumer/installed-cases.mjs';
import { checkConsumerTarballs, consumerSha256 } from './consumer-inputs.mjs';
import { checkMidnightRuntimeIdentity } from './check-midnight-runtime-identity.mjs';

const repository = resolve(import.meta.dirname, '..');
const [mode] = process.argv.slice(2);
if (!['prepare', 'run'].includes(mode ?? ''))
  throw Error('usage: qualify-installed-consumer.mjs prepare|run');
if (!process.env.CONSUMER_ROOT)
  throw Error('set CONSUMER_ROOT to a fresh private application outside the checkout');
const requested = resolve(process.env.CONSUMER_ROOT);
const root = existsSync(requested)
  ? realpathSync(requested)
  : join(realpathSync(dirname(requested)), basename(requested));
if (root === repository || root.startsWith(repository + sep) || repository.startsWith(root + sep))
  throw Error('consumer must be outside the SDK checkout');
const bundle = join(root, 'bundle'),
  configFile = join(root, 'qualification-inputs.json');
const hash = (/** @type {string} */ file) => consumerSha256(readFileSync(file));
const env = { ...process.env };
delete env.NODE_OPTIONS;
delete env.NODE_PATH;
delete env.NODE_TEST_CONTEXT;
/** @param {string} name @param {string[]} args @param {string} log */
function run(name, args, log) {
  const result = spawnSync(name, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  });
  writeFileSync(join(root, log), (result.stdout ?? '') + (result.stderr ?? ''), {
    flag: 'wx',
    mode: 0o600,
  });
  if (result.error || result.status !== 0)
    throw Error('installed consumer command failed; inspect its retained private log');
}
const names = () =>
  JSON.parse(readFileSync(join(bundle, 'manifest.json'), 'utf8')).files.map(
    (/** @type {{name:string}} */ f) => f.name,
  );
const runtime = () => Object.keys(checkMidnightRuntimeIdentity(root, names())).sort();
if (mode === 'prepare') {
  if (existsSync(root))
    throw Error('prepare requires a new consumer directory; failed preparations are retained');
  if (!process.env.RELEASE_VERSION || !process.env.RELEASE_TARBALL_DIR)
    throw Error('set RELEASE_VERSION and RELEASE_TARBALL_DIR');
  const inputs = checkConsumerTarballs(
    process.env.RELEASE_TARBALL_DIR,
    process.env.RELEASE_VERSION,
  );
  if (
    process.env.CONSUMER_MANIFEST_SHA256 &&
    process.env.CONSUMER_MANIFEST_SHA256 !== inputs.manifestSha256
  )
    throw Error('bundle differs from the externally pinned manifest');
  mkdirSync(root, { mode: 0o700 });
  mkdirSync(bundle, { mode: 0o700 });
  for (const { file } of inputs.files)
    copyFileSync(join(process.env.RELEASE_TARBALL_DIR, file), join(bundle, file));
  copyFileSync(
    join(process.env.RELEASE_TARBALL_DIR, 'manifest.json'),
    join(bundle, 'manifest.json'),
  );
  const copied = checkConsumerTarballs(bundle, inputs.version);
  if (copied.manifestSha256 !== inputs.manifestSha256) throw Error('bundle changed while copying');
  for (const { name, file } of copied.files) {
    const archive = packageArchive(readFileSync(join(bundle, file)));
    const pkg = JSON.parse(/** @type {Buffer} */ (archive.get('package.json')).toString());
    if (pkg.name !== name || pkg.version !== inputs.version)
      throw Error('tarball package identity differs');
  }
  const dependencies = Object.fromEntries(
    inputs.files.map(({ name, file }) => [name, 'file:bundle/' + file]),
  );
  const packageManager = JSON.parse(
    readFileSync(join(repository, 'package.json'), 'utf8'),
  ).packageManager;
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'passport-installed-qualification',
        private: true,
        type: 'module',
        packageManager,
        dependencies,
        pnpm: { overrides: dependencies },
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  let frozen = false;
  if (process.env.CONSUMER_LOCK_FILE) {
    const lockBytes = readFileSync(process.env.CONSUMER_LOCK_FILE);
    if (
      !/^[a-f0-9]{64}$/.test(process.env.CONSUMER_LOCK_SHA256 ?? '') ||
      consumerSha256(lockBytes) !== process.env.CONSUMER_LOCK_SHA256
    )
      throw Error('supplied consumer lock requires its matching external SHA-256');
    writeFileSync(join(root, 'pnpm-lock.yaml'), lockBytes, { flag: 'wx', mode: 0o600 });
    frozen = true;
  }
  run(
    'pnpm',
    [
      'install',
      '--ignore-scripts',
      '--ignore-pnpmfile',
      ...(frozen ? ['--offline', '--frozen-lockfile'] : ['--no-frozen-lockfile']),
    ],
    'prepare-install.log',
  );
  const installed = auditInstalledBundle(root, bundle, inputs.version);
  if (installed.manifestSha256 !== inputs.manifestSha256)
    throw Error('bundle changed during installation');
  const config = {
    schemaVersion: 1,
    version: inputs.version,
    manifestSha256: inputs.manifestSha256,
    packageJsonSha256: hash(join(root, 'package.json')),
    lockSha256: hash(join(root, 'pnpm-lock.yaml')),
    installed,
    runtimeIdentity: runtime(),
    packageManager,
    nodeVersion: process.version,
  };
  writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(
    JSON.stringify({
      kind: 'prepared-installed-consumer',
      sdkVersion: config.version,
      manifestSha256: config.manifestSha256,
      lockSha256: config.lockSha256,
      packages: installed.packages.length,
    }),
  );
} else {
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const configSha256 = hash(configFile);
  if (
    config.schemaVersion !== 1 ||
    typeof config.version !== 'string' ||
    !/^[a-f0-9]{64}$/.test(config.lockSha256) ||
    !/^[a-f0-9]{64}$/.test(config.manifestSha256)
  )
    throw Error('invalid retained consumer inputs');
  if (process.env.RELEASE_VERSION && config.version !== process.env.RELEASE_VERSION)
    throw Error('retained version differs');
  if (
    process.env.CONSUMER_MANIFEST_SHA256 &&
    config.manifestSha256 !== process.env.CONSUMER_MANIFEST_SHA256
  )
    throw Error('external manifest pin differs');
  if (process.env.CONSUMER_LOCK_SHA256 && config.lockSha256 !== process.env.CONSUMER_LOCK_SHA256)
    throw Error('external lock pin differs');
  const verify = () => {
    if (hash(configFile) !== configSha256 || config.nodeVersion !== process.version)
      throw Error('consumer inputs or Node runtime changed');
    if (
      hash(join(root, 'pnpm-lock.yaml')) !== config.lockSha256 ||
      hash(join(root, 'package.json')) !== config.packageJsonSha256
    )
      throw Error('retained consumer lock or manifest changed');
    const installed = auditInstalledBundle(root, bundle, config.version);
    if (JSON.stringify(installed) !== JSON.stringify(config.installed))
      throw Error('retained installed SDK differs');
    if (JSON.stringify(runtime()) !== JSON.stringify(config.runtimeIdentity))
      throw Error('runtime identity changed');
    return installed;
  };
  verify();
  const runId = randomUUID(),
    out = join(root, 'runs', runId);
  mkdirSync(out, { recursive: true, mode: 0o700 });
  // No new registry resolution: the prepared lock and already-populated local store must suffice.
  run(
    'pnpm',
    ['install', '--offline', '--frozen-lockfile', '--ignore-scripts', '--ignore-pnpmfile'],
    runId + '-install.log',
  );
  verify();
  const original = join(repository, 'scripts/consumer/installed-host-jobs.mjs');
  const harnessSha256 = hash(original),
    target = join(out, 'installed-host-jobs.mjs');
  copyFileSync(original, target);
  run(process.execPath, [target, 'suite', out], runId + '-scenarios.log');
  const cases = JSON.parse(readFileSync(join(out, 'cases.json'), 'utf8'));
  validateInstalledCases(cases);
  const installed = verify();
  if (hash(original) !== harnessSha256 || hash(target) !== harnessSha256)
    throw Error('qualification harness changed');
  const receipt = {
    schemaVersion: 1,
    kind: 'installed-candidate-interruption',
    runId,
    sdkVersion: config.version,
    manifestSha256: config.manifestSha256,
    lockSha256: config.lockSha256,
    harnessSha256,
    packageManager: config.packageManager,
    nodeVersion: process.version,
    installed: installed.packages,
    runtimeIdentity: config.runtimeIdentity,
    cases: cases.cases,
    consent: cases.consent,
    checks: [
      'tarball-sha256',
      'installed-file-bytes',
      'frozen-offline-install',
      'physical-runtime-identity',
      'actual-http-process-restart',
      'inputs-unchanged',
    ],
    allRequiredPassed: true,
    realProvider: false,
    fullLace: false,
    nativeProof: false,
    registryProvenance: false,
    releaseQualified: false,
  };
  writeFileSync(join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(JSON.stringify(receipt, null, 2));
}
