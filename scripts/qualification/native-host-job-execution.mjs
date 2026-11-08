// Resolve the two explicit host-job execution routes once, before inspecting resources.
import assert from 'node:assert/strict';
import { dedicatedIndexerReadiness } from './indexer-readiness.mjs';
import { admitIsolationProfile } from './native-isolation-profile.mjs';
/** @typedef {{docker:(args:string[])=>string,wait:(test:()=>Promise<boolean>,ms:number,terminal?:()=>boolean)=>Promise<void>,indexerReady:()=>Promise<boolean>}} RetainedExecution */
/** @param {'source'|'image'} lane @param {'creation'|'lifecycle'} profile
 * @param {import('./native-isolation-control.mjs').IsolatedHostContext|undefined} isolation
 * @param {RetainedExecution} retained */
export function hostJobExecution(lane, profile, isolation, retained) {
  if (isolation) {
    assert.equal(lane, 'source');
    assert.equal(profile, 'lifecycle');
    admitIsolationProfile(isolation.profile);
    isolation.check();
  } else {
    assert.ok(
      Object.keys(process.env).every((key) => !key.startsWith('PASSPORT_NATIVE_ISOLATION')),
      'An isolated descriptor cannot enter the retained runner',
    );
  }
  const endpoints = isolation
    ? isolation.profile.endpoints
    : {
        nodeUrl: 'http://127.0.0.1:19954',
        indexerUrl: 'http://127.0.0.1:18098/api/v4/graphql',
        indexerWsUrl: 'ws://127.0.0.1:18098/api/v4/graphql/ws',
        proverUrl: 'http://127.0.0.1:16310',
      };
  const command = isolation ? isolation.docker : retained.docker;
  /** @param {string} project @param {(value:unknown,name:string)=>string} requireOwned */
  const containers = (project, requireOwned) => {
    const names = isolation
      ? isolation.ids
      : ['node', 'indexer', 'proof-server'].map((role) => `${project}-${role}-1`);
    assert.equal(names.length, 3);
    const inspected = JSON.parse(command(['inspect', ...names]));
    assert.ok(Array.isArray(inspected) && inspected.length === 3);
    const ids = isolation
      ? [...isolation.ids]
      : inspected.map((value, index) => requireOwned(value, String(names[index])));
    const at = (/** @type {number} */ index) => {
      const id = ids[index];
      assert.equal(typeof id, 'string');
      assert.match(String(id), /^[a-f0-9]{64}$/);
      return String(id);
    };
    /** @type {[string,string,string]} */ const fixedIds = [at(0), at(1), at(2)];
    return { inspected, ids: fixedIds };
  };
  const servicePort = isolation ? isolation.profile.service.port : 18797;
  return {
    endpoints,
    servicePort,
    serviceUrl: `http://127.0.0.1:${servicePort}`,
    containers,
    docker: command,
    wait: isolation ? isolation.wait : retained.wait,
    indexerReady: isolation
      ? async () => (await dedicatedIndexerReadiness(endpoints)).ready
      : retained.indexerReady,
    env: isolation ? isolation.env : process.env,
    check: isolation ? isolation.check : () => {},
    remaining: isolation ? isolation.remaining : (/** @type {number} */ ms) => ms,
  };
}
