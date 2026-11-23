import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { verifyDemoArtefacts } from '../scripts/demo-artifact-pin.mjs';

/** @param {string} text */
const hash = (text) => createHash('sha256').update(text).digest('hex');

test('prototype startup checks stable reference and separate candidate bytes', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'passport-demo-artifact-pin-')));
  try {
    const reference = join(root, 'reference');
    const assets = join(root, 'candidate');
    const module = join(root, 'packaged-module.js');
    mkdirSync(join(reference, 'contracts/managed/account/compiler'), { recursive: true });
    mkdirSync(join(assets, 'compiler'), { recursive: true });
    mkdirSync(join(assets, 'contract'), { recursive: true });
    writeFileSync(
      join(reference, 'contracts/managed/account/compiler/contract-manifest.json'),
      'stable',
    );
    writeFileSync(join(assets, 'compiler/contract-manifest.json'), 'candidate');
    writeFileSync(join(assets, 'contract/index.js'), 'same module');
    writeFileSync(module, 'same module');
    const pins = {
      stable: { id: 'acc-s3r1.1', manifestSha256: hash('stable') },
      candidate: {
        provisional: true,
        manifestSha256: hash('candidate'),
        moduleHashes: { 'contract/index.js': hash('same module') },
      },
      packagedModule: module,
    };
    assert.equal(
      verifyDemoArtefacts(
        { PASSPORT_CONTRACT_DIR: reference, PASSPORT_MANIFEST_SHA256: hash('stable') },
        pins,
      ),
      'acc-s3r1.1',
    );
    const env = {
      PASSPORT_CONTRACT_DIR: reference,
      PASSPORT_MANIFEST_SHA256: hash('candidate'),
      PASSPORT_BINDING_ID: 'acc-s3r1.1-zkir036',
      PASSPORT_CANDIDATE_LOCAL: '1',
      PASSPORT_ARTEFACT_DIR: assets,
      MIDNIGHT_STACK: 'shared-ledger9',
      MN_NETWORK_ID: 'undeployed',
      VITE_MIDNAMES_REGISTRY_PROFILE: 'standalone-0.35',
    };
    assert.equal(verifyDemoArtefacts(env, pins), env.PASSPORT_BINDING_ID);
    const isolated = {
      ...env,
      MIDNIGHT_STACK: 'isolated-ledger9',
      VITE_MIDNAMES_REGISTRY_PROFILE: 'standalone-0.36.1',
      VITE_MIDNAMES_0361_ISOLATED: '1',
      PASSPORT_MIDNAMES_0361_ISOLATED: '1',
    };
    assert.equal(verifyDemoArtefacts(isolated, pins), env.PASSPORT_BINDING_ID);
    for (const changed of [
      { PASSPORT_MIDNAMES_0361_ISOLATED: '0' },
      { VITE_MIDNAMES_0361_ISOLATED: '0' },
      { MIDNIGHT_STACK: 'shared-ledger9' },
      { VITE_MIDNAMES_REGISTRY_PROFILE: 'standalone-0.35' },
    ])
      assert.throws(() => verifyDemoArtefacts({ ...isolated, ...changed }, pins));
    for (const changed of [
      { PASSPORT_CANDIDATE_LOCAL: '0' },
      { MIDNIGHT_STACK: 'undeployed' },
      { MN_NETWORK_ID: 'preview' },
      { VITE_MIDNAMES_REGISTRY_PROFILE: 'midnames-2.1.0' },
      { PASSPORT_MANIFEST_SHA256: hash('stable') },
      { PASSPORT_BINDING_ID: 'unknown' },
    ])
      assert.throws(() => verifyDemoArtefacts({ ...env, ...changed }, pins));
    writeFileSync(module, 'changed module');
    assert.throws(() => verifyDemoArtefacts(env, pins), /module bytes/);
  } finally {
    rmSync(root, { recursive: true });
  }
});
