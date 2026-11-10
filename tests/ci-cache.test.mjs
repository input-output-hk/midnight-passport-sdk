import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  realpathSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { publicCacheInputs, publicCacheStore } from '../scripts/ci/public-cache.mjs';
import { sealStore, admitStoreSeal } from '../scripts/ci/store-seal.mjs';

const env = {
  NPM_CONFIG_USERCONFIG: '/dev/null',
  NPM_CONFIG_GLOBALCONFIG: '/dev/null',
  NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
};
/** @param {import('node:test').TestContext} t */
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'public-cache-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, '.npmrc'), 'ignore-scripts=true\nverify-store-integrity=true\n');
  writeFileSync(
    join(root, 'pnpm-lock.yaml'),
    "lockfileVersion: '9.0'\npackages:\n  example@1.0.0:\n    resolution: {integrity: sha512-" +
      createHash('sha512').update('synthetic').digest('base64') +
      '}\n',
  );
  return root;
}

test('cache input admission requires isolated public registry and no lifecycle scripts or credentials', (t) => {
  const root = fixture(t);
  assert.equal(publicCacheInputs(root, env).packageVersions, 1);
  for (const extra of [
    { NPM_TOKEN: 'private' },
    { NPM_CONFIG__AUTH: 'private' },
    { npm_config_registry: 'https://private.invalid/' },
    { NPM_CONFIG_USERCONFIG: '/tmp/private' },
  ])
    assert.throws(() => publicCacheInputs(root, { ...env, ...extra }));
  for (const config of [
    'ignore-scripts=false',
    'ignore-scripts=true\n//registry.npmjs.org/:_authToken=private',
    'ignore-scripts=true\nuserconfig=/tmp/secret',
    'ignore-scripts=true\nverify-store-integrity=false',
    'ignore-scripts=true\npnpmfile=/tmp/hooks.js',
  ]) {
    writeFileSync(join(root, '.npmrc'), config + '\n');
    assert.throws(() => publicCacheInputs(root, env));
  }
});

test('cache refuses private scopes, registry redirects and tarball credential indirection', (t) => {
  const root = fixture(t),
    path = join(root, 'pnpm-lock.yaml'),
    lock = readFileSync(path, 'utf8');
  for (const pair of ['@input-output-hk/example@1.0.0', '@Input-Output-Hk/example@1.0.0']) {
    writeFileSync(path, lock.replace('example@1.0.0', pair));
    assert.throws(() => publicCacheInputs(root, env));
  }
  for (const url of [
    'https://private.invalid/a.tgz',
    'https://user:password@registry.npmjs.org/a.tgz',
    'https://registry.npmjs.org/a.tgz?token=private',
  ]) {
    writeFileSync(path, lock.replace(/integrity: sha512-[^}]+/, `tarball: ${url}`));
    assert.throws(() => publicCacheInputs(root, env));
    writeFileSync(path, lock.replace(/integrity: sha512-[^}]+/, `"tarball": "${url}"`));
    assert.throws(() => publicCacheInputs(root, env));
  }
  writeFileSync(path, lock.replace('example@1.0.0', '@example/public@1.0.0'));
  writeFileSync(
    join(root, '.npmrc'),
    'ignore-scripts=true\n@example:registry=https://private.invalid/\n',
  );
  assert.throws(() => publicCacheInputs(root, env));
});

test('store layout admission refuses empty caches and links reaching outside its root', (t) => {
  const root = fixture(t),
    store = join(root, 'store');
  mkdirSync(store);
  assert.throws(() => publicCacheStore(store));
  const digest = createHash('sha512').update('public bytes').digest('hex');
  const directory = join(store, 'v10', 'files', digest.slice(0, 2));
  mkdirSync(directory, { recursive: true });
  const file = join(directory, digest.slice(2));
  writeFileSync(file, 'public bytes');
  assert.equal(publicCacheStore(store).files, 1);
  assert.throws(() => admitStoreSeal(store), /Unsealed/);
  sealStore(store);
  admitStoreSeal(store);
  writeFileSync(file, 'corrupt bytes');
  assert.throws(() => publicCacheStore(store), /Corrupt pnpm/);
  writeFileSync(file, 'public bytes');
  writeFileSync(
    join(store, 'substituted-index.json'),
    JSON.stringify({ files: { 'index.js': { integrity: 'foreign' } } }),
  );
  assert.throws(() => admitStoreSeal(store), /catalog/);
  symlinkSync(join(root, '.npmrc'), join(store, 'credential-link'));
  assert.throws(() => publicCacheStore(store));
});

test('trusted warmer saves only after fresh frozen integrity checks and never caches workspace outputs', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/warm-dependencies.yml', import.meta.url),
    'utf8',
  );
  assert.match(workflow, /if: github.ref == 'refs\/heads\/passport-acc-prototype'/);
  assert.ok(
    workflow.indexOf('public-cache.mjs inputs') < workflow.indexOf('actions/cache/restore@'),
  );
  assert.ok(workflow.indexOf('--verify-store-integrity') < workflow.indexOf('actions/cache/save@'));
  assert.ok(workflow.indexOf('public-cache.mjs seal') < workflow.indexOf('actions/cache/save@'));
  assert.match(workflow, /persist-credentials: false/);
  assert.match(
    workflow,
    /--frozen-lockfile --prefer-offline --ignore-scripts --ignore-pnpmfile --verify-store-integrity/,
  );
  assert.equal(/pull_request_target|secrets\.|node_modules|\/dist\b/.test(workflow), false);
});

test('sealed download metadata refuses an index pointing at another correctly hashed CAS file', (t) => {
  const root = fixture(t),
    store = join(root, 'store');
  mkdirSync(store);
  for (const value of ['original bytes', 'alternate data']) {
    const digest = createHash('sha512').update(value).digest('hex');
    const dir = join(store, 'v10/files', digest.slice(0, 2));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, digest.slice(2)), value);
  }
  const dir = join(store, 'v10/index');
  mkdirSync(dir, { recursive: true });
  const index = join(dir, 'synthetic.json');
  writeFileSync(
    index,
    JSON.stringify({ integrity: createHash('sha512').update('original bytes').digest('base64') }),
  );
  mkdirSync(join(store, 'v10/projects'));
  symlinkSync(root, join(store, 'v10/projects', 'excluded-project-link'));
  sealStore(store);
  admitStoreSeal(store);
  writeFileSync(
    index,
    JSON.stringify({ integrity: createHash('sha512').update('alternate data').digest('base64') }),
  );
  assert.equal(publicCacheStore(store).contentFiles, 2);
  assert.throws(() => admitStoreSeal(store), /catalog/);
});
