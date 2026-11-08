// Frozen source/dist, physical dependencies and streamed key inventory; no package execution.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { workspaceIdentity, verifyQualificationBinding } from './receipt.mjs';
import { referenceFingerprint } from './live-outages.mjs';
import { installedTreeIdentity, runtimeTreeIdentity } from '../consumer/host-retained.mjs';
import { sessionDependencyIdentity } from './session-profile.mjs';
import { isolationObject } from './native-isolation-profile.mjs';
import {
  isolationArtifactInventory,
  isolationHashFile,
  verifyIsolationArtifacts,
} from './native-isolation-artifacts.mjs';
/** @param {string} root @param {string} contract @param {()=>void} check */
export async function isolatedInputs(root, contract, check) {
  check();
  const source = await workspaceIdentity(root);
  assert.equal(source.dirty, false, 'Freeze signed source before native qualification');
  assert.equal(
    execFileSync('git', ['log', '-1', '--format=%G?'], { cwd: root, encoding: 'utf8' }).trim(),
    'G',
  );
  const binding = await verifyQualificationBinding(root);
  const keyManifest = isolationObject(
    JSON.parse(
      readFileSync(join(root, 'packages/contract/resources/acc-s3r1.1.key-manifest.json'), 'utf8'),
    ),
  );
  assert.equal(keyManifest.compilerManifestSha256, binding.compilerManifestSha256);
  const keys = isolationArtifactInventory(keyManifest);
  await verifyIsolationArtifacts(contract, keys, check);
  const capture = async (guard = check) => {
    guard();
    return {
      source: await workspaceIdentity(root),
      binding: await verifyQualificationBinding(root),
      reference: await referenceFingerprint(contract),
      dependencies: sessionDependencyIdentity(root),
      referenceDependencies: installedTreeIdentity(contract),
      referenceSources: runtimeTreeIdentity(join(contract, 'src')),
      faucet: runtimeTreeIdentity(join(contract, 'contracts/managed/faucet')),
      generated: await isolationHashFile(
        join(contract, 'contracts/managed/account/contract/index.js'),
        guard,
      ),
      node: process.version,
      arch: process.arch,
      platform: process.platform,
    };
  };
  const frozen = await capture();
  assert.deepEqual(frozen.source, source);
  assert.equal(frozen.generated, binding.moduleSha256);
  const verify = async (/** @type {()=>void} */ guard) => {
    assert.deepEqual(await capture(guard), frozen, 'Native source/dependency/reference drift');
    await verifyIsolationArtifacts(contract, keys, guard);
  };
  return { frozen, keys, verify };
}
