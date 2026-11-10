#!/usr/bin/env node
// Admission for a public download cache. Never archives credentials or compiled outputs.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, lstatSync, realpathSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lockVersions, versionPair } from './lock-versions.mjs';
import { verifyStoreFile } from './store-content.mjs';
import { sealStore, admitStoreSeal } from './store-seal.mjs';

/** @param {string} root @param {NodeJS.ProcessEnv} [env] */
export function publicCacheInputs(root, env = process.env) {
  assert.equal(realpathSync(root), root);
  assert.equal(
    env.NPM_CONFIG_USERCONFIG,
    '/dev/null',
    'Public warming isolates user npm credentials',
  );
  assert.equal(
    env.NPM_CONFIG_GLOBALCONFIG,
    '/dev/null',
    'Public warming isolates global npm credentials',
  );
  assert.equal(env.NPM_CONFIG_REGISTRY, 'https://registry.npmjs.org/');
  for (const [name, value] of Object.entries(env))
    if (/^npm_config_/i.test(name)) {
      assert.equal(
        /auth|password|token/i.test(name) && Boolean(value),
        false,
        'Authenticated npm override refused',
      );
      if (/registry$/i.test(name)) assert.equal(value, 'https://registry.npmjs.org/');
      if (/userconfig$|globalconfig$/i.test(name)) assert.equal(value, '/dev/null');
    }
  const config = new Map();
  for (const line of readFileSync(join(root, '.npmrc'), 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const index = line.indexOf('=');
    assert.ok(index > 0, 'Unknown npm configuration');
    const name = line.slice(0, index).trim().toLowerCase(),
      value = line.slice(index + 1).trim();
    assert.equal(config.has(name), false, 'Duplicate npm configuration');
    assert.equal(
      /auth|password|token|certfile|keyfile|userconfig|globalconfig/.test(name),
      false,
      'Credentials/config indirection cannot enter public warming',
    );
    config.set(name, value);
  }
  assert.equal(
    config.get('ignore-scripts'),
    'true',
    'Public warming never executes dependency lifecycle scripts',
  );
  assert.ok(config.get('verify-store-integrity') !== 'false');
  for (const name of config.keys())
    assert.ok(
      [
        'ignore-scripts',
        'save-exact',
        'min-release-age',
        'verify-store-integrity',
        'registry',
      ].includes(name) || /^@[a-z0-9_-]+:registry$/.test(name),
      'Unsupported public warming npm configuration',
    );
  for (const name of ['NODE_AUTH_TOKEN', 'NPM_TOKEN', 'npm_config__auth', 'NPM_CONFIG__AUTH'])
    assert.ok(!env[name], 'Authenticated publisher environment refused');
  const registry = config.get('registry') ?? 'https://registry.npmjs.org/';
  assert.equal(registry, 'https://registry.npmjs.org/');
  const pairs = [
    ...lockVersions('pnpm-lock.yaml', readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')),
  ];
  for (const pair of pairs) {
    const name = versionPair(pair).name.toLowerCase();
    assert.equal(
      name.startsWith('@input-output-hk/'),
      false,
      'Private SDK packages cannot enter a public cache',
    );
    const scope = name.startsWith('@') ? name.split('/')[0] : null;
    if (scope && config.has(`${scope}:registry`))
      assert.equal(config.get(`${scope}:registry`), registry, 'Non-public scoped registry refused');
  }
  // Admit only canonical integrity-only resolutions. Quoted/flow/multiline
  // overrides are rejected rather than guessed; package names are insufficient.
  const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8');
  const resolutions = lock.split('\n').filter((line) => /^ {4}resolution:/.test(line));
  assert.equal(resolutions.length, pairs.length, 'One canonical resolution per package required');
  for (const line of resolutions)
    assert.match(
      line,
      /^ {4}resolution: \{integrity: sha512-[A-Za-z0-9+/]{86}==\}$/,
      'Only integrity-pinned public registry resolutions can be warmed',
    );
  return {
    kind: 'public-pnpm-download-inputs',
    packageVersions: pairs.length,
    registry,
    lifecycleScripts: false,
    privatePackageCredentials: false,
    dependencyIntegrityStillRequired: true,
  };
}

/** Directory admission complements pnpm's own cryptographic store verification.
 * @param {string} root */
export function publicCacheStore(root) {
  assert.equal(realpathSync(root), root);
  let files = 0,
    bytes = 0,
    entries = 0,
    contentFiles = 0;
  const walk = (/** @type {string} */ directory) => {
    for (const name of readdirSync(directory)) {
      assert.ok(++entries <= 200_000, 'Public store entry bound exceeded');
      const path = join(directory, name),
        stat = lstatSync(path);
      if (relative(root, path) === 'v10/projects') {
        assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
        continue;
      }
      assert.equal(stat.isSymbolicLink(), false, 'Cache links cannot reach credential files');
      if (stat.isDirectory()) walk(path);
      else {
        assert.equal(stat.isFile(), true, 'Special cache entries refused');
        files++;
        bytes += stat.size;
        assert.ok(bytes <= 2 * 1024 ** 3, 'Public store exceeds 2 GiB bound');
        if (verifyStoreFile(path, relative(root, path))) contentFiles++;
      }
    }
  };
  assert.equal(lstatSync(root).isDirectory(), true);
  walk(root);
  assert.ok(files > 0, 'Empty download cache is not a warm cache');
  assert.ok(contentFiles > 0, 'Supported pnpm10 content-addressed files required');
  return {
    kind: 'public-pnpm-store-layout',
    files,
    bytes,
    links: 0,
    contentFiles,
    contentVerifier: 'independent SHA-512 of every pnpm10 CAS file',
    lockfileProvenanceEstablishedByLayout: false,
    integrityVerifier:
      'pnpm frozen install --verify-store-integrity plus independent CAS hash check',
    compiledWorkspaceOutputsCached: false,
    projectLinksExcludedFromCache: true,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , mode, directory] = process.argv;
  assert.ok(
    process.argv.length === 4 &&
      directory &&
      ['inputs', 'store', 'restored', 'seal'].includes(String(mode)),
  );
  const root = resolve(directory);
  if (mode === 'restored' && existsSync(root)) admitStoreSeal(root);
  if (mode === 'seal') {
    publicCacheStore(root);
    console.log(JSON.stringify(sealStore(root)));
  } else
    console.log(
      JSON.stringify(
        mode === 'restored' && !existsSync(resolve(directory))
          ? { cache: 'absent', warm: false }
          : mode === 'inputs'
            ? publicCacheInputs(resolve(directory))
            : publicCacheStore(resolve(directory)),
      ),
    );
}
