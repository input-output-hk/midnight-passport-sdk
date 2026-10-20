#!/usr/bin/env node
// Cache identity is a performance hint. Only the pinned hashes accept key bytes.
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { appendFile, lstat, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { selectKeyProfile } from '../apps/passport-key-service/src/profiles.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const BINDING = 'acc-s3r1.1';
const MANIFEST = '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f';
const KEY_MANIFEST = '6f452180f8beb3b4c1844ac18be3517403412be0a06e055dcc867c18e69f52c5';
const MAX_BYTES = 1024 ** 3;
/** @param {Uint8Array | string} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * @typedef {{size: number, sha256: string}} Pin
 * @typedef {{cacheKey: string, directory: string, profile: string, circuits: string[], bytes: number,
 *   files: Record<string, Pin>, compilerManifestSha256: string}} CachePlan
 */

/**
 * The bounded owner profile is not a claim of complete consumer coverage.
 * @param {{root?: string, platform?: string, arch?: string, profile?: string}} options
 * @returns {Promise<CachePlan>}
 */
export async function planKeyCache({
  root = ROOT,
  platform = process.platform,
  arch = process.arch,
  profile = 'jubjub-owner-v1',
} = {}) {
  const resource = `packages/contract/resources/${BINDING}`;
  const keyManifestBytes = await readFile(join(root, `${resource}.key-manifest.json`));
  if (sha256(keyManifestBytes) !== KEY_MANIFEST) throw new Error('key manifest pin mismatch');
  const manifest = JSON.parse(keyManifestBytes.toString('utf8'));
  if (manifest.compilerManifestSha256 !== MANIFEST || manifest.bindingId !== BINDING)
    throw new Error('compiler manifest or binding pin mismatch');
  const provers = new Map(
    Object.keys(manifest.circuits).map((name) => [
      `${name}.prover`,
      manifest.circuits[name].prover,
    ]),
  );
  const circuits = selectKeyProfile(profile, provers).circuits.sort();
  /** @type {Record<string, Pin>} */
  const files = {};
  for (const name of circuits)
    for (const kind of ['prover', 'verifier']) {
      const pin = manifest.circuits[name][kind];
      if (!Number.isSafeInteger(pin?.size) || pin.size <= 0 || !/^[a-f0-9]{64}$/.test(pin.sha256))
        throw new Error(`invalid key pin: ${name}.${kind}`);
      files[`${name}.${kind}`] = pin;
    }
  const bytes = Object.values(files).reduce((total, pin) => total + pin.size, 0);
  if (bytes > MAX_BYTES)
    throw new Error(`profile exceeds the ${MAX_BYTES}-byte CI cache budget: ${bytes}`);
  // Include generation/verification logic as well as the exact toolchain and input bytes.
  const inputs = [
    `${resource}.key-manifest.json`,
    `${resource}.zkir.json.gz`,
    'flake.lock',
    'flake.nix',
    'nix/packages/compact.nix',
    'packages/contract/bin/restore-acc-keys.mjs',
    'apps/passport-key-service/src/profiles.mjs',
    'scripts/ci-key-cache.mjs',
  ];
  const hashes = await Promise.all(
    inputs.map(async (path) => [path, sha256(await readFile(join(root, path)))]),
  );
  const fingerprint = sha256(
    JSON.stringify({ format: 1, binding: BINDING, platform, arch, profile, circuits, hashes }),
  );
  const cacheKey = `passport-keys-v1-${platform}-${arch}-${fingerprint}`;
  return {
    cacheKey,
    directory: `.cache/passport-keys/${cacheKey}`,
    profile,
    circuits,
    bytes,
    files,
    compilerManifestSha256: MANIFEST,
  };
}

/**
 * Refuse incomplete, corrupt, extra or symlinked cache contents before any consumer starts.
 * @param {CachePlan} plan
 * @param {string} directory
 */
export async function verifyKeyCache(plan, directory) {
  const names = await readdir(directory);
  const expected = Object.keys(plan.files).sort();
  if (JSON.stringify(names.sort()) !== JSON.stringify(expected))
    throw new Error('key cache does not contain the exact selected key set');
  for (const name of expected) {
    const file = join(directory, name);
    const stat = await lstat(file);
    const pin = /** @type {Pin} */ (plan.files[name]);
    if (!stat.isFile() || stat.size !== pin.size) throw new Error(`invalid cached key: ${name}`);
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(file)) hash.update(chunk);
    if (hash.digest('hex') !== pin.sha256) throw new Error(`cached key hash mismatch: ${name}`);
  }
  return { verified: expected.length, bytes: plan.bytes, cacheKey: plan.cacheKey };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [command, flag] = process.argv.slice(2);
  if (!['plan', 'verify'].includes(command ?? '') || (flag && flag !== '--github-output'))
    throw new Error('usage: ci-key-cache.mjs plan [--github-output] | verify');
  const plan = await planKeyCache();
  if (command === 'verify') {
    console.log(JSON.stringify(await verifyKeyCache(plan, resolve(ROOT, plan.directory))));
  } else {
    console.log(JSON.stringify(plan, null, 2));
    if (flag === '--github-output') {
      if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is missing');
      await appendFile(
        process.env.GITHUB_OUTPUT,
        `key=${plan.cacheKey}\ndirectory=${plan.directory}\ncircuits=${plan.circuits.join(',')}\nbytes=${plan.bytes}\n`,
      );
    }
  }
}
