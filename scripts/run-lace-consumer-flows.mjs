#!/usr/bin/env node
// Isolated protocol diagnostics; never writes host implementation files or widens consent.
import {
  constants,
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { checkConsumerSource, checkConsumerTarballs } from './consumer-inputs.mjs';
import { checkMidnightRuntimeIdentity } from './check-midnight-runtime-identity.mjs';
import { runCommand } from './qualification/runner.mjs';

const mode = process.argv[2];
const modes = {
  ports: {
    fixtures: ['signer-consent.diagnostic.test.ts', 'sdk-key-ports.diagnostic.test.ts'],
    native: ['test/ceremony/passkey.test.ts', 'test/ceremony/encryption-key.test.ts'],
    timeout: 60000,
  },
  keys: { fixtures: ['key-http.diagnostic.test.ts'], native: [], timeout: 120000 },
  'hosted-device': {
    fixtures: ['sdk-hosted-authorising-device.localnet.test.ts'],
    native: [],
    timeout: 1800000,
  },
  'reverse-open': {
    fixtures: ['lace-native-sdk-open.localnet.test.ts'],
    native: [],
    timeout: 1800000,
  },
};
const selected = /** @type {Record<string,{fixtures:string[],native:string[],timeout:number}>} */ (
  modes
)[mode ?? ''];
if (!selected) throw new Error('select ports, keys, hosted-device or reverse-open');
const checkout = process.env.LACE_CHECKOUT;
const consumer = process.env.CONSUMER_ROOT;
const revision = process.env.LACE_SOURCE_REVISION;
if (!checkout || !consumer || !revision || process.env.LACE_DIAGNOSTIC_CHECKOUT !== '1')
  throw new Error(
    'supply an authorised disposable LACE_CHECKOUT, CONSUMER_ROOT, exact LACE_SOURCE_REVISION and LACE_DIAGNOSTIC_CHECKOUT=1',
  );
const cwd = realpathSync(consumer),
  source = realpathSync(checkout);
if (realpathSync(join(source, 'node_modules')) !== realpathSync(join(cwd, 'node_modules')))
  throw new Error('diagnostic source and consumer must resolve the same installed dependency tree');
const scopes = [
  'packages/contract',
  'packages/lib',
  'packages/module/passport-account/src',
  'packages/module/passport-account/package.json',
];
const identity = checkConsumerSource(source, revision, scopes);
const bundle = checkConsumerTarballs(
  resolve(process.env.RELEASE_TARBALL_DIR ?? ''),
  process.env.RELEASE_VERSION ?? '',
);
checkMidnightRuntimeIdentity(
  cwd,
  bundle.files.map(({ name }) => name),
);
for (const { name } of bundle.files) {
  const pkg = JSON.parse(readFileSync(join(cwd, 'node_modules', name, 'package.json'), 'utf8'));
  if (pkg.name !== name || pkg.version !== bundle.version)
    throw new Error('installed SDK identity differs from the declared bundle');
}
if (mode === 'hosted-device' || mode === 'reverse-open') {
  if (process.env.PASSPORT_LACE_HOSTED_E2E !== '1' || !process.env.PASSPORT_CONTRACT_DIR)
    throw new Error(
      'localnet diagnostics require PASSPORT_LACE_HOSTED_E2E=1 and PASSPORT_CONTRACT_DIR',
    );
}
if (mode === 'keys' || mode === 'hosted-device' || mode === 'reverse-open') {
  const url = new URL(
    (mode === 'keys' ? process.env.PASSPORT_KEY_SERVICE_URL : process.env.PASSPORT_SERVICE_URL) ??
      '',
  );
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  )
    throw new Error('diagnostic services must be explicit loopback origins without credentials');
}
const target = join(source, 'packages/module/passport-account/test/remote');
const files = selected.fixtures.map((file) => join(target, file));
if (files.some(existsSync)) throw new Error('refusing to overwrite existing diagnostic fixtures');
const scratch = mkdtempSync(join(cwd, '.sdk-host-qualification-'));
/** @type {string[]} */ const copied = [];
const alias = /** @type {Record<string,string>} */ ({});
for (const group of ['contract', 'lib', 'module']) {
  const directory = join(source, 'packages', group);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const manifest = join(directory, entry.name, 'package.json');
    const index = join(directory, entry.name, 'src/index.ts');
    if (!entry.isDirectory() || !existsSync(manifest) || !existsSync(index)) continue;
    alias[JSON.parse(readFileSync(manifest, 'utf8')).name] = index;
  }
}
alias['@scure/bip39/wordlists/english.js'] = join(
  cwd,
  'node_modules/@scure/bip39/wordlists/english.js',
);
try {
  for (const file of selected.fixtures) {
    const destination = join(target, file);
    copyFileSync(
      join(import.meta.dirname, '../experiments/lace-consumer', file),
      destination,
      constants.COPYFILE_EXCL,
    );
    copied.push(destination);
  }
  const config = join(scratch, 'vitest.config.mjs');
  writeFileSync(
    config,
    `import {defineConfig} from 'vitest/config';export default defineConfig(${JSON.stringify({
      resolve: { alias },
      test: {
        globals: true,
        environment: 'node',
        pool: 'forks',
        maxWorkers: 1,
        minWorkers: 1,
        include: [
          ...files,
          ...selected.native.map((path) => join(source, 'packages/module/passport-account', path)),
        ],
        testTimeout: selected.timeout,
        hookTimeout: 120000,
      },
    })});\n`,
  );
  const report = join(scratch, 'tests.json');
  const result = await runCommand(
    {
      tier: 'consumer',
      requires: [],
      establishes: '',
      timeoutMs: selected.timeout + 30000,
      command: [
        process.execPath,
        join(cwd, 'node_modules/vitest/vitest.mjs'),
        'run',
        '--config',
        config,
        '--reporter=json',
        '--outputFile',
        report,
      ],
    },
    { root: cwd, maxOutputBytes: 1024 * 1024 },
  );
  if (result.outcome !== 'passed' || !existsSync(report)) {
    const failure = {
      schemaVersion: 1,
      kind: 'consumer-protocol-failure',
      mode,
      source: identity,
      sdkVersion: bundle.version,
      commandResult: result,
      fullCompatibility: false,
      realProvider: false,
    };
    if (process.env.CONSUMER_RECEIPT_FILE)
      writeFileSync(process.env.CONSUMER_RECEIPT_FILE, JSON.stringify(failure, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
    throw new Error(
      `consumer diagnostic failed (${result.failureCode ?? 'MISSING_REPORT'}); rerun the named fixture with Vitest for detailed diagnostics`,
    );
  }
  const tests = JSON.parse(readFileSync(report, 'utf8'));
  if (
    !tests.success ||
    tests.numFailedTests ||
    tests.numPendingTests ||
    tests.numTodoTests ||
    !tests.numPassedTests
  )
    throw new Error('consumer diagnostic contains failures, skips or no passing tests');
  checkConsumerSource(source, revision, scopes);
  const receipt = {
    schemaVersion: 1,
    kind: 'consumer-protocol',
    mode,
    source: identity,
    sdkVersion: bundle.version,
    manifestSha256: bundle.manifestSha256,
    commandResult: result,
    testsPassed: tests.numPassedTests,
    network: mode === 'hosted-device' || mode === 'reverse-open' ? 'undeployed' : null,
    syntheticCredentials: true,
    simulatedWindows: true,
    fullCompatibility: false,
    realProvider: false,
  };
  if (process.env.CONSUMER_RECEIPT_FILE)
    writeFileSync(process.env.CONSUMER_RECEIPT_FILE, JSON.stringify(receipt, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  for (const file of copied) rmSync(file, { force: true });
  rmSync(scratch, { recursive: true, force: true });
}
