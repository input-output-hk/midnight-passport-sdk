import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { selectedAccountProviders, selectedAccountSetup } from '../src/reference-modules.ts';
import type { ProofProviderModule, SetupModule, ZkConfigModule } from '../src/reference-runtime.ts';

test('an explicit ACC root rebinds the compiled contract without changing the reference setup', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'passport-asset-selector-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const packagePath = join(root, 'package.json');
  mkdirSync(join(root, 'dist/esm'), { recursive: true });
  writeFileSync(
    packagePath,
    JSON.stringify({
      type: 'module',
      version: '3.0.0-rc.3',
      exports: { '.': { import: './dist/esm/index.js' } },
    }),
  );
  writeFileSync(
    join(root, 'dist/esm/index.js'),
    'export const CompiledContract = { getCompiledAssetsPath: (value) => value.path, withCompiledFileAssets: (value, path) => ({ ...value, path }) };\n',
  );
  const reference = '/reference';
  const original = join(reference, 'contracts/managed/account');
  const setup = {
    setupWallet: async () => ({ providers: {} }),
    compiledAccountContract: () => ({ path: original }),
  } as unknown as SetupModule;
  const resolvePackage = () => packagePath;
  const old = await selectedAccountSetup(
    { contractDir: reference, artefactDir: original },
    setup,
    () => {
      throw new Error('default must not load another runtime');
    },
  );
  assert.equal(old, setup);
  const selected = await selectedAccountSetup(
    { contractDir: reference, artefactDir: '/candidate/account' },
    setup,
    resolvePackage,
  );
  assert.deepEqual(selected.compiledAccountContract(), { path: '/candidate/account' });
  assert.deepEqual(setup.compiledAccountContract(), { path: original });
  await assert.rejects(
    selectedAccountSetup(
      { contractDir: reference, artefactDir: '/candidate/account' },
      { ...setup, compiledAccountContract: () => ({ path: '/wrong/account' }) },
      resolvePackage,
    ),
    /reference compiled ACC assets differ/,
  );
});

test('an explicit ACC root selects both verifier and transaction-proof providers', () => {
  const oldRoot = '/reference/contracts/managed/account';
  const config = {
    contractDir: '/reference',
    artefactDir: '/candidate/account',
    proofServerUri: 'http://proof',
  };
  const original = { zkConfigProvider: { source: 'old' }, proofProvider: { source: 'old' } };
  const registry = { source: 'candidate' };
  const zkConfig = {
    NodeZkConfigProvider: class {
      constructor(readonly root: string) {}
      async getVerifierKey() {
        return new Uint8Array();
      }
    },
  } as unknown as ZkConfigModule;
  const proof = {
    httpClientProofProvider: (url: string, source: unknown) => ({ url, source }),
  } as unknown as ProofProviderModule;
  assert.equal(
    selectedAccountProviders(
      { ...config, artefactDir: oldRoot },
      original,
      registry,
      zkConfig,
      proof,
    ),
    original,
  );
  const selected = selectedAccountProviders(config, original, registry, zkConfig, proof);
  assert.equal((selected.zkConfigProvider as { root?: string }).root, config.artefactDir);
  assert.deepEqual(selected.proofProvider, { url: config.proofServerUri, source: registry });
  assert.deepEqual(original, {
    zkConfigProvider: { source: 'old' },
    proofProvider: { source: 'old' },
  });
});
