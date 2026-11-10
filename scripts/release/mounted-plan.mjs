// Closed standalone topology: application Host validation requires equal mapped/configured ports.
import assert from 'node:assert/strict';
import { absolutePath } from './plan.mjs';
import { exact, object, text } from './files.mjs';
import { ISOLATED_IMAGES } from '../qualification/native-isolated-stack.mjs';

/** @param {unknown} input */
export function mountedPlan(input) {
  const row = object(input);
  exact(row, ['schemaVersion', 'source', 'contract', 'linuxDependencies', 'images', 'chainImages']);
  assert.equal(row.schemaVersion, 1);
  const deps = object(row.linuxDependencies);
  exact(deps, ['volume', 'lockSha256', 'treeSha256']);
  assert.ok(Array.isArray(row.images) && row.images.length === 2);
  const images = row.images.map((input) => {
    const image = object(input);
    exact(image, ['role', 'repository', 'digest']);
    const role = text(image.role, /^(?:service|funding)$/);
    assert.equal(image.repository, `ghcr.io/input-output-hk/midnight-passport-${role}`);
    return {
      role: /** @type {'service'|'funding'} */ (role),
      repository: String(image.repository),
      digest: text(image.digest, /^sha256:[a-f0-9]{64}$/),
    };
  });
  assert.deepEqual(images.map((image) => image.role).sort(), ['funding', 'service']);
  assert.ok(Array.isArray(row.chainImages) && row.chainImages.length === 3);
  const chainImages = row.chainImages.map((input) => {
    const image = object(input);
    exact(image, ['role', 'tag', 'id']);
    const role = text(image.role, /^(?:node|indexer|proof-server)$/);
    assert.equal(image.tag, ISOLATED_IMAGES.find((pin) => pin.service === role)?.tag);
    return {
      role: /** @type {'node'|'indexer'|'proof-server'} */ (role),
      tag: String(image.tag),
      id: text(image.id, /^sha256:[a-f0-9]{64}$/),
    };
  });
  assert.deepEqual(chainImages.map((image) => image.role).sort(), [
    'indexer',
    'node',
    'proof-server',
  ]);
  return {
    source: text(row.source, /^[a-f0-9]{40}$/),
    contract: absolutePath(row.contract),
    linuxDependencies: {
      volume: text(deps.volume, /^[a-z0-9][a-z0-9-]+$/),
      lockSha256: text(deps.lockSha256, /^[a-f0-9]{64}$/),
      treeSha256: text(deps.treeSha256, /^[a-f0-9]{64}$/),
    },
    images,
    chainImages,
  };
}
export const MOUNTED_PORTS = Object.freeze({ service: 18790, funding: 18791 });
/** @param {number} published @param {number} configured */
export function applicationPort(published, configured) {
  assert.ok(Number.isSafeInteger(published) && published >= 1024 && published <= 65535);
  assert.equal(
    published,
    configured,
    'Port translation would fail Host validation before dispatch',
  );
  return `127.0.0.1:${published}:${configured}`;
}
