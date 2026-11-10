// Exact verifier catalog and payload checks against an independently pinned compiler manifest.
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { boundedBody } from './transport.mjs';
import { object, sha256 } from './files.mjs';
import { imageCase } from './image-runtime.mjs';

/** @param {unknown} actual @param {string[]} expected */
export function exactCatalog(actual, expected) {
  assert.ok(Array.isArray(actual) && actual.every((value) => typeof value === 'string'));
  assert.equal(new Set(actual).size, actual.length, 'Duplicate verifier catalog entry');
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    'Verifier catalog differs from pinned manifest',
  );
}
/** @param {Response} response @param {Buffer} bytes @param {Buffer} expected @param {number} fullSize */
export function verifyRange(response, bytes, expected, fullSize) {
  assert.equal(response.status, 206);
  assert.ok(bytes.equals(expected), 'Range payload differs from verified source');
  assert.equal(response.headers.get('content-range'), `bytes 0-${expected.length - 1}/${fullSize}`);
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
}
/** @param {string} url @param {RequestInit} [init] */
async function get(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  });
  return { response, bytes: await boundedBody(response, 32 * 1024 * 1024) };
}
const PROFILE = [
  'activate_initial_device_with_jubjub',
  'add_device_with_jubjub',
  'append_inbox_with_jubjub',
  'deposit_shielded',
  'deposit_unshielded',
  'issue_grant_with_jubjub',
  'remove_device_with_jubjub',
  'revoke_all_grants_with_jubjub',
  'revoke_grant_with_jubjub',
  'rotate_enc_key_with_jubjub',
];
/** The key image uses a Nix-store application tree, unlike backend /opt/passport images.
 * @param {import('./image-runtime.mjs').PulledImage} image */
export function keyImageTools(image) {
  assert.ok(
    Array.isArray(image.cmd) &&
      image.cmd.length === 2 &&
      typeof image.cmd[0] === 'string' &&
      typeof image.cmd[1] === 'string',
    'Key image command layout not admitted',
  );
  assert.match(image.cmd[0], /^\/nix\/store\/[a-z0-9]{32}-nodejs-[^/]+\/bin\/node$/);
  assert.match(
    image.cmd[1],
    /^\/nix\/store\/[a-z0-9]{32}-passport-key-service-app\/apps\/passport-key-service\/src\/main\.mjs$/,
  );
  return {
    node: image.cmd[0],
    restore: image.cmd[1].replace(
      '/apps/passport-key-service/src/main.mjs',
      '/packages/contract/bin/restore-acc-keys.mjs',
    ),
  };
}
/** @param {{compilerManifest:string,compilerManifestSha256:string,publicKeys:string}} plan @param {string} root @param {import('./resources.mjs').ResourceOwner} owner @param {import('./image-runtime.mjs').PulledImage} image */
export async function keyRuntime(plan, root, owner, image) {
  const raw = readFileSync(plan.compilerManifest);
  assert.equal(sha256(raw), plan.compilerManifestSha256);
  const manifest = JSON.parse(raw.toString());
  const verifiers = Object.keys(manifest.keys)
    .filter((name) => name.endsWith('.verifier'))
    .map((name) => name.replace(/\.verifier$/, ''));
  assert.equal(verifiers.length, 52);
  const cache = join(root, 'key-cache');
  mkdirSync(cache, { mode: 0o755 });
  for (const circuit of PROFILE)
    for (const extension of ['prover', 'verifier']) {
      const name = `${circuit}.${extension}`,
        bytes = readFileSync(join(plan.publicKeys, name));
      assert.equal(sha256(bytes), manifest.keys[name]?.hash);
      assert.equal(bytes.length, manifest.keys[name]?.size);
      copyFileSync(join(plan.publicKeys, name), join(cache, name));
      chmodSync(join(cache, name), 0o644);
    }
  const row = owner.create(
    'container',
    `passport-${owner.runId}-key-http`,
    [
      '--platform',
      'linux/amd64',
      '--read-only',
      '--tmpfs',
      '/tmp:mode=1777',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--mount',
      `type=bind,src=${cache},dst=/data/keys,readonly`,
      '-e',
      'PASSPORT_KEY_PROFILE=jubjub-owner-v1',
      '-e',
      'PASSPORT_KEY_CORS_ORIGINS=http://localhost:5173',
      '-p',
      '127.0.0.1::8788',
      image.id,
    ],
    image.id,
  );
  owner.start(row);
  const networks = object(owner.inspect(row).NetworkSettings),
    ports = object(networks.Ports),
    binding = ports['8788/tcp'];
  assert.ok(Array.isArray(binding) && binding.length === 1 && binding[0].HostIp === '127.0.0.1');
  const port = String(binding[0].HostPort);
  assert.match(port, /^[0-9]+$/);
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    assert.equal(object(owner.inspect(row).State).Running, true);
    try {
      ready = (await get(base + '/healthz')).response.status === 200;
    } catch {
      /* bounded readiness only */
    }
    if (ready) break;
    await delay(500);
  }
  assert.ok(ready, 'Owned key image not ready');
  const profile = JSON.parse((await get(base + '/v1/profile')).bytes.toString());
  exactCatalog(profile.verifierCircuits, verifiers);
  exactCatalog(profile.circuits, PROFILE);
  const compiler = await get(base + '/zk/acc/compiler/contract-manifest.json');
  assert.equal(compiler.response.status, 200);
  assert.equal(sha256(compiler.bytes), plan.compilerManifestSha256);
  const hashes = [];
  for (const circuit of verifiers) {
    const name = circuit + '.verifier',
      result = await get(base + '/v1/zk/acc-s3r1.1/keys/' + name);
    assert.equal(result.response.status, 200);
    assert.equal(result.bytes.length, manifest.keys[name].size);
    assert.equal(sha256(result.bytes), manifest.keys[name].hash);
    hashes.push({ name, sha256: sha256(result.bytes) });
  }
  const selected = 'deposit_unshielded.prover',
    source = readFileSync(join(cache, selected));
  const full = await get(base + '/v1/zk/acc-s3r1.1/keys/' + selected);
  assert.equal(full.response.status, 200);
  assert.ok(full.bytes.equals(source));
  const range = await get(base + '/v1/zk/acc-s3r1.1/keys/' + selected, {
    headers: { Range: 'bytes=0-15', Origin: 'http://localhost:5173' },
  });
  verifyRange(range.response, range.bytes, source.subarray(0, 16), source.length);
  const unselected = verifiers.find((circuit) => !PROFILE.includes(circuit));
  assert.ok(unselected);
  assert.equal(
    (await get(base + '/v1/zk/acc-s3r1.1/keys/' + unselected + '.prover')).response.status,
    404,
  );
  owner.stop(row);
  const regenerated = join(root, 'regenerated-key');
  mkdirSync(regenerated, { mode: 0o777 });
  chmodSync(regenerated, 0o777);
  const tools = keyImageTools(image);
  imageCase(
    owner,
    image,
    'key-restore',
    ['--entrypoint', tools.node, '--mount', `type=bind,src=${regenerated},dst=/data/keys`],
    [
      tools.restore,
      '--binding',
      'acc-s3r1.1',
      '--output',
      '/data/keys',
      '--circuit',
      'deposit_unshielded',
    ],
    undefined,
    undefined,
    root,
  );
  for (const extension of ['prover', 'verifier']) {
    const name = `deposit_unshielded.${extension}`;
    assert.equal(sha256(readFileSync(join(regenerated, name))), manifest.keys[name].hash);
  }
  for (const circuit of PROFILE)
    for (const extension of ['prover', 'verifier']) {
      const name = `${circuit}.${extension}`;
      assert.equal(sha256(readFileSync(join(plan.publicKeys, name))), manifest.keys[name].hash);
      assert.equal(sha256(readFileSync(join(cache, name))), manifest.keys[name].hash);
    }
  return {
    kind: 'actual-key-image-runtime',
    verifierHashes: hashes,
    exactCatalog: true,
    fullProverSha256: sha256(source),
    rangeBytesAndCors: true,
    singleCircuitRestored: true,
    sourceKeysUnchanged: true,
    nativeProof: false,
  };
}
