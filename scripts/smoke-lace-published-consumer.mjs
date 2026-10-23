#!/usr/bin/env node
// Run after an authorised registry install. Keep credentials in the package manager's environment.
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { consumerSha256 } from './consumer-inputs.mjs';
import { releasePackageDirectories } from './release-package-list.mjs';
import { checkMidnightRuntimeIdentity } from './check-midnight-runtime-identity.mjs';

const root = realpathSync(resolve(process.env.CONSUMER_ROOT ?? ''));
const hostVersion = process.env.LACE_PACKAGE_VERSION;
const sdkVersion = process.env.RELEASE_VERSION;
if (!process.env.CONSUMER_ROOT || !hostVersion || !sdkVersion)
  throw new Error('set CONSUMER_ROOT, LACE_PACKAGE_VERSION and RELEASE_VERSION');
const host = JSON.parse(readFileSync(join(root, 'node_modules/@laceio/sdk/package.json'), 'utf8'));
if (host.name !== '@laceio/sdk' || host.version !== hostVersion)
  throw new Error('installed host package identity differs');
const sdkNames = releasePackageDirectories.map((name) => `@input-output-hk/mn-passport-${name}`);
for (const name of sdkNames) {
  const pkg = JSON.parse(readFileSync(join(root, 'node_modules', name, 'package.json'), 'utf8'));
  if (pkg.name !== name || pkg.version !== sdkVersion)
    throw new Error('installed SDK package identity differs');
}
const identities = checkMidnightRuntimeIdentity(root, ['@laceio/sdk', ...sdkNames]);
const entries = ['./experimental', './midnight'];
const entryChecks = entries.map((entry) => {
  const exports = host.exports?.[entry];
  if (!exports || !['types', 'import', 'require'].every((key) => typeof exports[key] === 'string'))
    throw new Error('host entry declaration/import/require metadata is missing');
  const hashes = Object.fromEntries(
    ['types', 'import', 'require'].map((key) => {
      const path = resolve(root, 'node_modules/@laceio/sdk', exports[key]);
      if (!existsSync(path)) throw new Error('host entry artifact is absent');
      return [key, consumerSha256(readFileSync(path))];
    }),
  );
  // Cold processes exercise each real export condition, not an accidental cached module.
  const specifier = '@laceio/sdk/' + entry.slice(2);
  const esm = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const m=await import(${JSON.stringify(specifier)});if(typeof m.createLaceWallet!=='function')throw Error('missing wallet export');`,
    ],
    { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 256 * 1024 },
  );
  if (esm.status !== 0) throw new Error(`host ESM entry failed: ${entry}`);
  const cjs = spawnSync(
    process.execPath,
    [
      '-e',
      `const m=require(${JSON.stringify(specifier)});if(typeof m.createLaceWallet!=='function')throw Error('missing wallet export');`,
    ],
    { cwd: root, encoding: 'utf8', timeout: 60000, maxBuffer: 256 * 1024 },
  );
  if (cjs.status !== 0) throw new Error(`host CJS entry failed: ${entry}`);
  return { entry, hashes, esm: 'passed', cjs: 'passed' };
});
const fixture = join(root, 'sdk-published-consumer.ts');
const browser = join(root, 'sdk-consumer-browser');
if (existsSync(fixture) || existsSync(browser))
  throw new Error('use a fresh consumer output directory');
copyFileSync(join(import.meta.dirname, '../tests/fixtures/lace-published-consumer.ts'), fixture);
execFileSync(
  'pnpm',
  [
    'exec',
    'tsc',
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--target',
    'ES2022',
    '--module',
    'ESNext',
    '--moduleResolution',
    'Bundler',
    fixture,
  ],
  { cwd: root, stdio: 'inherit' },
);
mkdirSync(browser);
writeFileSync(join(browser, 'index.html'), '<script type="module" src="/main.js"></script>');
writeFileSync(
  join(browser, 'main.js'),
  `
import { m } from '@laceio/sdk/experimental';
import { createPassportAccounts } from '@input-output-hk/mn-passport-account';
import { hostedJubjubAuthoriser } from '@input-output-hk/mn-passport-adapter-browser/hosted-jubjub';
document.body.textContent = [m.createPassportAccountModule.name, createPassportAccounts.name, hostedJubjubAuthoriser.name].join(' ');
`,
);
// The selected host actually imports Ledger WASM. The SDK-only tree-shaken smoke does not
// exercise that requirement. Use a real WASM build rather than externalising the host import.
writeFileSync(
  join(browser, 'vite.config.mjs'),
  `
import { defineConfig } from 'vite';
import wasm from 'vite-plugin-wasm';
export default defineConfig({plugins:[wasm()],build:{target:'esnext'}});
`,
);
execFileSync(
  'pnpm',
  ['exec', 'vite', 'build', browser, '--config', join(browser, 'vite.config.mjs')],
  { cwd: root, stdio: 'inherit' },
);
const lock = join(root, 'pnpm-lock.yaml');
if (!existsSync(lock)) throw new Error('record a resolved consumer lockfile');
const receipt = {
  schemaVersion: 1,
  kind: 'installed-published-host',
  host: { name: host.name, version: host.version },
  sdkVersion,
  lockSha256: consumerSha256(readFileSync(lock)),
  entryChecks,
  runtimeIdentity: Object.keys(identities),
  checks: [
    'installed-versions',
    'physical-runtime-identity',
    'public-entry-types',
    'esm-entries',
    'browser-build',
  ],
  fullCompatibility: false,
  realProvider: false,
  localnet: false,
};
if (process.env.CONSUMER_RECEIPT_FILE)
  writeFileSync(process.env.CONSUMER_RECEIPT_FILE, JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
console.log(JSON.stringify(receipt, null, 2));
