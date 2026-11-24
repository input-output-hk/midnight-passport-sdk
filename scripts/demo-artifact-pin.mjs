import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stable = JSON.parse(
  readFileSync(join(root, 'packages/contract/acc-binding-v2.generated.json'), 'utf8'),
);
const candidate = JSON.parse(
  readFileSync(join(root, 'packages/contract/acc-versions.generated.json'), 'utf8'),
).versions['acc-s3r1.1-zkir036'];
const packagedModule = join(root, 'packages/contract/generated/acc-s3r1.1/index.js');
/** @param {string} file */
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The reference client remains stable; only verified service assets change.
 * @param {NodeJS.ProcessEnv} env
 * @param {{ stable: { id: string, manifestSha256: string }, candidate: { provisional: boolean, manifestSha256: string, moduleHashes: Record<string, string> }, packagedModule: string }} pins
 */
export function verifyDemoArtefacts(env, pins = { stable, candidate, packagedModule }) {
  const reference = env.PASSPORT_CONTRACT_DIR;
  const selectedManifest = env.PASSPORT_MANIFEST_SHA256?.toLowerCase();
  if (!reference || !isAbsolute(reference) || !/^[a-f0-9]{64}$/.test(selectedManifest ?? ''))
    throw new Error('Set an absolute PASSPORT_CONTRACT_DIR and exact PASSPORT_MANIFEST_SHA256.');
  if (
    digest(join(reference, 'contracts/managed/account/compiler/contract-manifest.json')) !==
    pins.stable.manifestSha256
  )
    throw new Error('The reference client must retain the packaged stable ACC manifest.');
  const bindingId = env.PASSPORT_BINDING_ID ?? pins.stable.id;
  if (bindingId === pins.stable.id) {
    if (selectedManifest !== pins.stable.manifestSha256)
      throw new Error('The stable demo requires its packaged ACC manifest.');
    return bindingId;
  }
  if (bindingId !== 'acc-s3r1.1-zkir036' || !pins.candidate.provisional)
    throw new Error('Unknown provisional ACC binding.');
  const shared035 =
    env.MIDNIGHT_STACK === 'shared-ledger9' &&
    env.VITE_MIDNAMES_REGISTRY_PROFILE === 'standalone-0.35' &&
    env.PASSPORT_MIDNAMES_0361_ISOLATED !== '1';
  const isolated0361 =
    env.MIDNIGHT_STACK === 'isolated-ledger9' &&
    env.VITE_MIDNAMES_REGISTRY_PROFILE === 'standalone-0.36.1' &&
    env.VITE_MIDNAMES_0361_ISOLATED === '1' &&
    env.PASSPORT_MIDNAMES_0361_ISOLATED === '1';
  if (
    env.PASSPORT_CANDIDATE_LOCAL !== '1' ||
    env.MN_NETWORK_ID !== 'undeployed' ||
    !(shared035 || isolated0361) ||
    selectedManifest !== pins.candidate.manifestSha256
  )
    throw new Error('Candidate ACC requires the exact local Ledger 9 profile and manifest.');
  const assets = env.PASSPORT_ARTEFACT_DIR;
  if (
    !assets ||
    !isAbsolute(assets) ||
    !lstatSync(assets).isDirectory() ||
    lstatSync(assets).isSymbolicLink() ||
    realpathSync(assets) !== assets
  )
    throw new Error('Candidate ACC needs a separate absolute real asset directory.');
  if (
    digest(join(assets, 'compiler/contract-manifest.json')) !== pins.candidate.manifestSha256 ||
    digest(join(assets, 'contract/index.js')) !==
      pins.candidate.moduleHashes['contract/index.js'] ||
    digest(pins.packagedModule) !== pins.candidate.moduleHashes['contract/index.js']
  )
    throw new Error('Candidate ACC asset or packaged module bytes differ from their pins.');
  return bindingId;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(`prototype-up: verified ${verifyDemoArtefacts(process.env)} ACC assets`);
  } catch (error) {
    console.error(`prototype-up: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
