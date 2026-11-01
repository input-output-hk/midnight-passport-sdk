#!/usr/bin/env node
// Fresh, opt-in registry consumers. No host checkout, live wallet or secret generation.
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { consumerSha256, isExactConsumerVersion } from './consumer-inputs.mjs';
import {
  auditHostConsumer,
  checkHostArchive,
  checkPublicationBundle,
} from './consumer/host-inputs.mjs';
import {
  hostConsumerHarness,
  retainedRuntimeIdentity,
  verifyRetainedHostConsumer,
  verifyHostEntryReceipt,
} from './consumer/host-retained.mjs';

const repository = resolve(import.meta.dirname, '..');
const mode = process.argv[2];
if (!['prepare', 'run'].includes(mode ?? '') || !process.env.CONSUMER_ROOT)
  throw Error('usage: CONSUMER_ROOT=<fresh external app> qualify-host-consumer.mjs prepare|run');
const requested = resolve(process.env.CONSUMER_ROOT);
const root = existsSync(requested)
  ? realpathSync(requested)
  : join(realpathSync(dirname(requested)), basename(requested));
if (root === repository || root.startsWith(repository + sep) || repository.startsWith(root + sep))
  throw Error('host consumer must be outside the SDK checkout');
const bundle = join(root, 'bundle'),
  configFile = join(root, 'host-consumer-inputs.json');
const hash = (/** @type {string} */ file) => consumerSha256(readFileSync(file));
const exact = isExactConsumerVersion;
const env = { ...process.env };
for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_TEST_CONTEXT']) delete env[name];
/** @param {string} executable @param {string[]} args @param {string} log */
function command(executable, args, log) {
  const result = spawnSync(executable, args, {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 4 * 1024 * 1024,
  });
  writeFileSync(join(root, log), (result.stdout ?? '') + (result.stderr ?? ''), {
    flag: 'wx',
    mode: 0o600,
  });
  if (result.status !== 0 || result.error)
    throw Error('host consumer command failed; retain its private log');
}
if (mode === 'prepare') {
  if (existsSync(root))
    throw Error('prepare requires a new consumer directory; failed setups are retained');
  const version = process.env.RELEASE_VERSION ?? '',
    sdkBundle = process.env.RELEASE_TARBALL_DIR ?? '';
  const receiptBytes = readFileSync(process.env.SDK_PUBLICATION_RECEIPT ?? '');
  const receiptSha256 = process.env.SDK_PUBLICATION_RECEIPT_SHA256 ?? '';
  const inputs = checkPublicationBundle(sdkBundle, version, receiptBytes, receiptSha256);
  const pin = {
    name: '@laceio/sdk',
    version: process.env.LACE_PACKAGE_VERSION ?? '',
    sha256: process.env.LACE_TARBALL_SHA256 ?? '',
    integrity: process.env.LACE_TARBALL_INTEGRITY ?? '',
  };
  const hostBytes = readFileSync(process.env.LACE_TARBALL_FILE ?? '');
  checkHostArchive(hostBytes, pin);
  const extra = JSON.parse(readFileSync(process.env.CONSUMER_DEPENDENCIES_FILE ?? '', 'utf8'));
  const reserved = new Set([...inputs.files.map((f) => f.name), pin.name]);
  for (const section of ['dependencies', 'devDependencies']) {
    if (
      extra[section] === null ||
      typeof extra[section] !== 'object' ||
      Array.isArray(extra[section])
    )
      throw Error('explicit dependency and development dependency maps are required');
    for (const [name, v] of Object.entries(extra[section])) {
      if (!/^(@[a-z0-9-]+\/)?[a-z0-9.-]+$/.test(name) || reserved.has(name) || !exact(v))
        throw Error('consumer dependencies must use exact versions without SDK/host overrides');
    }
  }
  if (Object.keys(extra).some((k) => !['dependencies', 'devDependencies'].includes(k)))
    throw Error(
      'consumer dependency file must not inject hooks, scripts or package-manager config',
    );
  mkdirSync(root, { mode: 0o700 });
  mkdirSync(bundle, { mode: 0o700 });
  for (const { file } of inputs.files) copyFileSync(join(sdkBundle, file), join(bundle, file));
  copyFileSync(join(sdkBundle, 'manifest.json'), join(bundle, 'manifest.json'));
  writeFileSync(join(bundle, 'host.tgz'), hostBytes, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(bundle, 'publication-receipt.json'), receiptBytes, {
    flag: 'wx',
    mode: 0o600,
  });
  const packageManager = JSON.parse(
    readFileSync(join(repository, 'package.json'), 'utf8'),
  ).packageManager;
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'passport-host-qualification',
        private: true,
        type: 'module',
        packageManager,
        dependencies: {
          ...extra.dependencies,
          ...Object.fromEntries(inputs.files.map((f) => [f.name, version])),
          [pin.name]: pin.version,
        },
        devDependencies: extra.devDependencies,
      },
      null,
      2,
    ) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  let frozen = false;
  if (process.env.CONSUMER_LOCK_FILE) {
    const bytes = readFileSync(process.env.CONSUMER_LOCK_FILE);
    if (
      !/^[a-f0-9]{64}$/.test(process.env.CONSUMER_LOCK_SHA256 ?? '') ||
      consumerSha256(bytes) !== process.env.CONSUMER_LOCK_SHA256
    )
      throw Error('frozen consumer lock needs its matching external SHA-256');
    writeFileSync(join(root, 'pnpm-lock.yaml'), bytes, { flag: 'wx', mode: 0o600 });
    frozen = true;
  }
  command(
    'pnpm',
    [
      'install',
      '--ignore-scripts',
      '--ignore-pnpmfile',
      ...(frozen ? ['--offline', '--frozen-lockfile'] : ['--no-frozen-lockfile']),
    ],
    'prepare-install.private.log',
  );
  const installed = auditHostConsumer(root, bundle, version, pin);
  checkPublicationBundle(
    bundle,
    version,
    readFileSync(join(bundle, 'publication-receipt.json')),
    receiptSha256,
  );
  const runtimeIdentity = retainedRuntimeIdentity(root, [
    pin.name,
    ...inputs.files.map((f) => f.name),
  ]);
  const config = {
    schemaVersion: 2,
    prepareHarness: hostConsumerHarness(repository),
    version,
    pin,
    receiptSha256,
    manifestSha256: inputs.manifestSha256,
    packageJsonSha256: hash(join(root, 'package.json')),
    lockSha256: hash(join(root, 'pnpm-lock.yaml')),
    installed,
    runtimeIdentity,
    nodeVersion: process.version,
    packageManager,
  };
  writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(
    JSON.stringify({
      kind: 'prepared-published-host-consumer',
      hostVersion: pin.version,
      sdkVersion: version,
      configSha256: hash(configFile),
      lockSha256: config.lockSha256,
      installedSdkFiles: installed.sdk.packages.reduce((n, p) => n + p.files, 0),
      installedHostFiles: installed.host.installed.files,
    }),
  );
} else {
  const expected = process.env.CONSUMER_CONFIG_SHA256;
  if (!/^[a-f0-9]{64}$/.test(expected ?? '') || hash(configFile) !== expected)
    throw Error('retained host consumer requires its external configuration SHA-256');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  const verify = () => verifyRetainedHostConsumer(root, expected ?? '', repository);
  const source = hostConsumerHarness(repository);
  verify();
  const receipt = join(root, 'public-entry-receipt.json');
  if (existsSync(receipt) || existsSync(join(root, 'host-consumer-receipt.json')))
    throw Error('host consumer output already exists; preserve the earlier run');
  Object.assign(env, {
    CONSUMER_ROOT: root,
    LACE_PACKAGE_VERSION: config.pin.version,
    RELEASE_VERSION: config.version,
    CONSUMER_RECEIPT_FILE: receipt,
  });
  command(
    process.execPath,
    [join(repository, 'scripts/smoke-lace-published-consumer.mjs')],
    'public-entry.private.log',
  );
  verify();
  if (JSON.stringify(hostConsumerHarness(repository)) !== JSON.stringify(source))
    throw Error('qualification harness changed during the run');
  const entry = JSON.parse(readFileSync(receipt, 'utf8'));
  verifyHostEntryReceipt(entry, config);
  const result = {
    schemaVersion: 2,
    kind: 'verified-published-host-consumer',
    harness: source,
    sdkVersion: config.version,
    hostVersion: config.pin.version,
    configSha256: expected,
    lockSha256: config.lockSha256,
    publicationReceiptSha256: config.receiptSha256,
    installed: config.installed,
    runtimeSnapshot: Object.fromEntries(
      Object.entries(config.runtimeIdentity).map(([name, value]) => [
        name,
        { ...value, path: undefined, pathSha256: consumerSha256(value.path) },
      ]),
    ),
    entry,
    fullCompatibility: false,
    realProvider: false,
    localnet: false,
  };
  writeFileSync(join(root, 'host-consumer-receipt.json'), JSON.stringify(result, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(JSON.stringify(result, null, 2));
}
