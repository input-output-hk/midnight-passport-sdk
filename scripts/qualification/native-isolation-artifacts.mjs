// Exact public-manifest artifact inventory shared by initial and final native checks.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { isolationObject } from './native-isolation-profile.mjs';
/** @typedef {{readonly path:string,readonly sha256:string}} IsolationArtifact */
/** Copies public pins before asynchronous file access. Binary ZKIR is used by the provider.
 * @param {unknown} manifest @returns {readonly IsolationArtifact[]} */
export function isolationArtifactInventory(manifest) {
  const circuits = isolationObject(isolationObject(manifest).circuits);
  assert.ok(Object.keys(circuits).length > 0, 'Empty native artifact inventory');
  /** @type {IsolationArtifact[]} */ const artifacts = [];
  for (const [circuit, input] of Object.entries(circuits)) {
    assert.match(circuit, /^[a-z0-9_]+$/);
    const pins = isolationObject(input);
    for (const kind of ['zkir', 'bzkir', 'prover', 'verifier']) {
      const pin = isolationObject(pins[kind]);
      assert.equal(typeof pin.sha256, 'string');
      const sha256 = String(pin.sha256);
      assert.match(sha256, /^[a-f0-9]{64}$/);
      const directory = kind === 'zkir' || kind === 'bzkir' ? 'zkir' : 'keys';
      artifacts.push(
        Object.freeze({
          path: `contracts/managed/account/${directory}/${circuit}.${kind}`,
          sha256,
        }),
      );
    }
  }
  return Object.freeze(artifacts);
}
/** Streams large keys and checks the same bounded abort/deadline guard during reading.
 * @param {string} path @param {()=>void} check */
export async function isolationHashFile(path, check) {
  check();
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) {
    check();
    hash.update(bytes);
  }
  return hash.digest('hex');
}
/** @param {string} contract @param {readonly IsolationArtifact[]} inventory @param {()=>void} check */
export async function verifyIsolationArtifacts(contract, inventory, check) {
  for (const artifact of inventory)
    assert.equal(
      await isolationHashFile(join(contract, artifact.path), check),
      artifact.sha256,
      `Pinned native artifact mismatch: ${artifact.path}`,
    );
}
