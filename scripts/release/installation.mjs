// Fresh registry install with temporary user credentials; no hooks or public archive mirror.
import assert from 'node:assert/strict';
import { installedFence } from './fences.mjs';
import { copyFileSync, lstatSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { auditInstalledBundle } from '../consumer/installed-inputs.mjs';
import { checkMidnightRuntimeIdentity } from '../check-midnight-runtime-identity.mjs';
import {
  captureInstalledQuality,
  installedQualityContext,
} from '../consumer/installed-quality-inputs.mjs';
import { json, put, sha256 } from './files.mjs';
import { loggedCommand, probeEnvironment } from './process.mjs';

/** @param {string} repository @param {string} root @param {string} version @param {string} token */
function prepareRegistryConsumer(repository, root, version, token) {
  const consumer = join(root, 'consumer');
  mkdirSync(consumer, { mode: 0o700 });
  mkdirSync(join(consumer, 'bundle'), { mode: 0o700 });
  const manifest = json(join(root, 'bundle/manifest.json'));
  for (const file of [
    'manifest.json',
    ...manifest.files.map((/** @type {{file:string}} */ row) => row.file),
  ])
    copyFileSync(join(root, 'bundle', file), join(consumer, 'bundle', file));
  const dependencies = Object.fromEntries(
    manifest.files.map((/** @type {{name:string}} */ row) => [row.name, version]),
  );
  const packageManager = json(join(repository, 'package.json')).packageManager;
  put(
    join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'passport-release-acceptance',
        private: true,
        type: 'module',
        packageManager,
        dependencies,
        devDependencies: { vite: '8.3.1', typescript: '6.0.3' },
        pnpm: { overrides: dependencies },
      },
      null,
      2,
    ) + '\n',
  );
  put(
    join(consumer, 'pnpm-workspace.yaml'),
    'minimumReleaseAge: 10080\nblockExoticSubdeps: true\ntrustPolicy: no-downgrade\nminimumReleaseAgeExclude:\n' +
      Object.keys(dependencies)
        .map((name) => `  - ${JSON.stringify(name + '@' + version)}`)
        .join('\n') +
      '\n',
  );
  const auth = join(root, 'temporary-user.npmrc');
  put(
    auth,
    '@input-output-hk:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}\n',
  );
  const identity = lstatSync(auth);
  try {
    loggedCommand(
      consumer,
      'install.private.log',
      'pnpm',
      ['install', '--ignore-scripts', '--ignore-pnpmfile', '--no-frozen-lockfile'],
      {
        cwd: consumer,
        timeout: 300_000,
        env: { ...process.env, GITHUB_TOKEN: token, NPM_CONFIG_USERCONFIG: auth },
      },
    );
  } finally {
    assert.equal(lstatSync(auth).ino, identity.ino, 'Temporary auth file was substituted');
    unlinkSync(auth);
  }
  const hash = (/** @type {string} */ file) => sha256(readFileSync(join(consumer, file)));
  const installed = auditInstalledBundle(consumer, join(consumer, 'bundle'), version);
  const runtimeIdentity = Object.keys(
    checkMidnightRuntimeIdentity(consumer, Object.keys(dependencies)),
  ).sort();
  const pins = {
    schemaVersion: 1,
    version,
    manifestSha256: installed.manifestSha256,
    packageJsonSha256: hash('package.json'),
    lockSha256: hash('pnpm-lock.yaml'),
    installed,
    runtimeIdentity,
    packageManager,
    nodeVersion: process.version,
  };
  put(join(consumer, 'qualification-inputs.json'), JSON.stringify(pins, null, 2) + '\n');
  return { consumer, pins, installed, hash };
}

/** @param {string} repository @param {string} root @param {string} version @param {string} token */
export async function installRegistryConsumer(repository, root, version, token) {
  const { consumer, pins, installed, hash } = prepareRegistryConsumer(
    repository,
    root,
    version,
    token,
  );
  const context = installedQualityContext({
    consumer,
    repository,
    version,
    manifestSha256: pins.manifestSha256,
    lockSha256: pins.lockSha256,
  });
  const receipt = await installedFence(
    () => captureInstalledQuality(context),
    async () => {
      copyFileSync(
        join(repository, 'scripts/consumer/installed-host-jobs.mjs'),
        join(consumer, 'installed-host-jobs.mjs'),
      );
      mkdirSync(join(consumer, 'interruptions'));
      const env = {
        ...probeEnvironment(),
        CONSUMER_ROOT: consumer,
        RELEASE_VERSION: version,
        CONSUMER_MANIFEST_SHA256: pins.manifestSha256,
        CONSUMER_LOCK_SHA256: pins.lockSha256,
      };
      loggedCommand(
        consumer,
        'release-checks.private.log',
        process.execPath,
        [
          join(repository, 'scripts/consumer/installed-release.mjs'),
          '--output',
          join(consumer, 'release-checks'),
        ],
        { cwd: consumer, env, timeout: 300_000 },
      );
      loggedCommand(
        consumer,
        'interruptions.private.log',
        process.execPath,
        ['installed-host-jobs.mjs', 'suite', join(consumer, 'interruptions')],
        { cwd: consumer, env, timeout: 180_000 },
      );
      mkdirSync(join(consumer, 'src'));
      put(
        join(consumer, 'index.html'),
        '<html><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>',
      );
      put(
        join(consumer, 'src/main.js'),
        "import {createAccountAuthorisation} from '@input-output-hk/mn-passport-account/authorisation';\nimport {createBrowserPassport} from '@input-output-hk/mn-passport-adapter-browser';\nimport {createMemorySecretStore} from '@input-output-hk/mn-passport-account/secret-store';\ndocument.querySelector('#app').textContent=[createAccountAuthorisation.name,createBrowserPassport.name,createMemorySecretStore.name].join(' ');\n",
      );
      loggedCommand(consumer, 'browser-build.private.log', 'pnpm', ['exec', 'vite', 'build'], {
        cwd: consumer,
        env,
        timeout: 180_000,
      });
      for (const [name, script, args] of [
        [
          'restore',
          'restore-acc-keys.mjs',
          [
            '--binding',
            'acc-s3r1.1',
            '--output',
            join(consumer, 'restored-keys'),
            '--circuit',
            'deposit_unshielded',
          ],
        ],
        ['export', 'export-acc-compact.mjs', ['--output', join(consumer, 'compiler-dependency')]],
      ])
        loggedCommand(
          consumer,
          `${name}.private.log`,
          process.execPath,
          [
            join(
              consumer,
              'node_modules/@input-output-hk/mn-passport-contract/bin',
              String(script),
            ),
            .../** @type {string[]} */ (args),
          ],
          { cwd: consumer, env, timeout: 300_000 },
        );
      assert.deepEqual(
        auditInstalledBundle(consumer, join(consumer, 'bundle'), version),
        installed,
      );
      assert.equal(hash('pnpm-lock.yaml'), pins.lockSha256);
      return {
        kind: 'actual-registry-installed-consumer',
        ...pins,
        temporaryAuthRemoved: true,
        qualityAndCrypto: true,
        syntheticInterruptions: true,
        browserBuild: true,
        oneCircuitRestore: true,
        compilerExport: true,
        nativeProof: false,
        realProvider: false,
      };
    },
    (fence) => put(join(root, 'installation-fence.json'), JSON.stringify(fence, null, 2) + '\n'),
  );
  put(join(root, 'installation.json'), JSON.stringify(receipt, null, 2) + '\n');
  return receipt;
}
