// Closed source lifecycle profile. This module has no filesystem/process/network effects.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isAbsolute, normalize } from 'node:path';

export const ISOLATED_KIND = 'source-host-job-lifecycle';
export const ISOLATED_PORTS = Object.freeze({
  node: 19964,
  indexer: 18108,
  prover: 16320,
  service: 18798,
});
export const ISOLATED_ENDPOINTS = Object.freeze({
  nodeUrl: 'http://127.0.0.1:19964',
  indexerUrl: 'http://127.0.0.1:18108/api/v4/graphql',
  indexerWsUrl: 'ws://127.0.0.1:18108/api/v4/graphql/ws',
  proverUrl: 'http://127.0.0.1:16320',
});
/** @typedef {{readonly schema:1,readonly kind:typeof ISOLATED_KIND,readonly runId:string,readonly project:string,readonly outputRoot:string,readonly endpoints:typeof ISOLATED_ENDPOINTS,readonly service:{readonly host:'127.0.0.1',readonly port:18798}}} IsolationProfile */
/** @param {unknown} value @returns {Record<string,unknown>} */
export function isolationObject(value) {
  assert.ok(
    value && typeof value === 'object' && !Array.isArray(value),
    'Expected isolation object',
  );
  return Object.fromEntries(Object.entries(value));
}
/** @param {Record<string,unknown>} value @param {string[]} keys */
function exact(value, keys) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), 'Unexpected isolation fields');
}
/** @param {string} runId @param {string} outputRoot @returns {IsolationProfile} */
export function isolationProfile(runId, outputRoot) {
  assert.match(runId, /^[a-f0-9]{16}$/);
  assert.ok(isAbsolute(outputRoot) && normalize(outputRoot) === outputRoot && outputRoot !== '/');
  return Object.freeze({
    schema: 1,
    kind: ISOLATED_KIND,
    runId,
    project: `mn-passport-joblife-${runId}`,
    outputRoot,
    endpoints: ISOLATED_ENDPOINTS,
    service: Object.freeze({ host: '127.0.0.1', port: 18798 }),
  });
}
/** Admission copies the closed canonical model, never the caller's nested references.
 * @param {unknown} input @returns {IsolationProfile} */
export function admitIsolationProfile(input) {
  const value = isolationObject(input);
  exact(value, ['schema', 'kind', 'runId', 'project', 'outputRoot', 'endpoints', 'service']);
  assert.equal(typeof value.runId, 'string');
  assert.equal(typeof value.outputRoot, 'string');
  const profile = isolationProfile(String(value.runId), String(value.outputRoot));
  assert.deepEqual(
    value,
    profile,
    'Isolation profile differs from the closed source lifecycle profile',
  );
  return profile;
}
/** @param {IsolationProfile} profile */
export function isolationDigest(profile) {
  return createHash('sha256')
    .update(JSON.stringify(admitIsolationProfile(profile)))
    .digest('hex');
}
/** @param {IsolationProfile} profile */
export function isolationEnvironment(profile) {
  const p = admitIsolationProfile(profile);
  return {
    PASSPORT_NATIVE_ISOLATION: p.kind,
    PASSPORT_NATIVE_ISOLATION_FILE: `${p.outputRoot}/isolation.json`,
    PASSPORT_NATIVE_ISOLATION_SHA256: isolationDigest(p),
    PASSPORT_NATIVE_ISOLATION_RUN_ID: p.runId,
    MN_NODE_URL: p.endpoints.nodeUrl,
    MN_INDEXER_URL: p.endpoints.indexerUrl,
    MN_INDEXER_WS_URL: p.endpoints.indexerWsUrl,
    MN_PROOF_SERVER_URL: p.endpoints.proverUrl,
    PASSPORT_SERVICE_HOST: p.service.host,
    PASSPORT_SERVICE_PORT: String(p.service.port),
  };
}

export const ISOLATION_FORBIDDEN_NAMES = Object.freeze([
  'PASSPORT_SPONSOR_SEED',
  'PASSPORT_SPONSOR_SEED_FILE',
  'WALLET_SEED',
  'NODE_OPTIONS',
  'NODE_PATH',
  'WALLET_SEED_FILE',
  'MN_NODE_PORT',
  'MN_INDEXER_PORT',
  'MN_INDEXER_WS_PORT',
  'MN_PROOF_PORT',
]);
export const ISOLATION_FORBIDDEN_PREFIXES = Object.freeze([
  'LD_',
  'DYLD_',
  'PASSPORT_NATIVE_JOB_',
  'PASSPORT_HOST_JOB_',
  'PASSPORT_HOST_MUTATION_',
  'PASSPORT_BROWSER_GRANT_',
  'PASSPORT_PUBLIC_',
  'PASSPORT_SESSION_',
]);
/** Parent and workers reject inherited private/runtime routing overrides.
 * PASSPORT_CONTRACT_DIR remains the separately frozen reference; LIVE_ROOT and the
 * optional wallet owner fixture are validated against the descriptor by the caller.
 * @param {NodeJS.ProcessEnv} env */
export function assertIsolationOverrides(env) {
  for (const [name, value] of Object.entries(env)) {
    if (
      value !== undefined &&
      (ISOLATION_FORBIDDEN_NAMES.includes(name) ||
        ISOLATION_FORBIDDEN_PREFIXES.some((prefix) => name.startsWith(prefix)))
    )
      throw new Error(`Forbidden isolated qualification override: ${name}`);
  }
}
