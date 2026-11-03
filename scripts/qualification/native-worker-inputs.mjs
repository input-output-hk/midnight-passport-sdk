// Private worker runtime paths come from its controlled environment, never a public receipt.
import assert from 'node:assert/strict';
import { isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
const consumerSha256 = (/** @type {string} */ value) =>
  createHash('sha256').update(value).digest('hex');

/** @param {{root:string,sha256:string}|undefined} signer */
export function nativeSignerInputIdentity(signer) {
  if (!signer) return undefined;
  assert.match(signer.sha256, /^[a-f0-9]{64}$/);
  return { configSha256: signer.sha256, preparedRootPathSha256: consumerSha256(signer.root) };
}
/** @param {{keys:string,signer?:{root:string,sha256:string}|undefined}} options */
export function nativeWorkerInputIdentity({ keys, signer }) {
  return {
    keyDirectoryPathSha256: consumerSha256(keys),
    signer: nativeSignerInputIdentity(signer),
  };
}
/** Validate the actual producer schema before imports, HTTP, wallet or chain activity.
 * @param {any} input @param {NodeJS.ProcessEnv} env
 */
export function nativeWorkerConfiguration(input, env) {
  assert.equal(input.kind, 'published-host-native-inputs');
  assert.ok(['public-module', 'hosted-authorising'].includes(input.profile));
  const keyDir = env.PASSPORT_KEY_DIR ?? '';
  assert.ok(isAbsolute(keyDir));
  assert.equal(input.keyDirectoryPathSha256, consumerSha256(keyDir));
  if (input.profile === 'public-module') {
    assert.equal(input.signer, undefined);
    return { keyDir, signerRoot: undefined };
  }
  const signerRoot = env.PASSPORT_SIGNER_ROOT ?? '';
  assert.ok(isAbsolute(signerRoot));
  assert.match(env.PASSPORT_SIGNER_SHA256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(input.signer?.configSha256, env.PASSPORT_SIGNER_SHA256);
  assert.equal(input.signer?.preparedRootPathSha256, consumerSha256(signerRoot));
  return { keyDir, signerRoot };
}
