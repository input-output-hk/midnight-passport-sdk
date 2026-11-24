import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

/**
 * What a build of the page pins, read from the environment by vite.config.ts: the artefact
 * manifest hash (R18) and the Midnight network id the connector is bound to.
 */
export function readPins(env: NodeJS.ProcessEnv): { manifestSha256: string; networkId: string } {
  const manifestSha256 = env.PASSPORT_MANIFEST_SHA256 ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(manifestSha256)) {
    throw new Error(
      "passport-dapp: set PASSPORT_MANIFEST_SHA256 to the 64 hex characters of the SHA-256 of the artefacts' contract-manifest.json.",
    );
  }
  // A bech32 prefix part and a key-derivation context (`<networkId>/0`); same rule as the service.
  const networkId = env.PASSPORT_NETWORK_ID ?? 'undeployed';
  if (!/^[a-z0-9][a-z0-9-]*$/.test(networkId)) {
    throw new Error(
      `passport-dapp: PASSPORT_NETWORK_ID must be lower-case letters, digits and hyphens, got "${networkId}".`,
    );
  }
  return { manifestSha256: manifestSha256.toLowerCase(), networkId };
}

interface BindingPin {
  readonly manifestSha256: string;
  readonly moduleHashes?: { readonly 'contract/index.js': string };
}

/** A provisional ACC is an explicit local source profile with independently pinned bytes. */
export function readDemoBinding(
  env: NodeJS.ProcessEnv,
  pins: ReturnType<typeof readPins>,
  stable: BindingPin,
  candidate: BindingPin,
): string {
  const id = env.PASSPORT_BINDING_ID ?? 'acc-s3r1.1';
  if (id === 'acc-s3r1.1') {
    if (pins.manifestSha256 !== stable.manifestSha256)
      throw new Error('passport-dapp: manifest must pin the packaged acc-s3r1.1 binding');
    return id;
  }
  if (id !== 'acc-s3r1.1-zkir036') throw new Error('passport-dapp: unknown ACC binding');
  const shared035 =
    env.VITE_MIDNAMES_REGISTRY_PROFILE === 'standalone-0.35' &&
    env.PASSPORT_MIDNAMES_0361_ISOLATED !== '1';
  const isolated0361 =
    env.MIDNIGHT_STACK === 'isolated-ledger9' &&
    env.VITE_MIDNAMES_REGISTRY_PROFILE === 'standalone-0.36.1' &&
    env.VITE_MIDNAMES_0361_ISOLATED === '1' &&
    env.PASSPORT_MIDNAMES_0361_ISOLATED === '1';
  if (
    env.PASSPORT_CANDIDATE_LOCAL !== '1' ||
    pins.networkId !== 'undeployed' ||
    !(shared035 || isolated0361) ||
    pins.manifestSha256 !== candidate.manifestSha256
  )
    throw new Error('passport-dapp: provisional ACC requires the exact local candidate profile');
  const assets = env.PASSPORT_ARTEFACT_DIR;
  if (
    !assets ||
    !isAbsolute(assets) ||
    lstatSync(assets).isSymbolicLink() ||
    realpathSync(assets) !== assets
  )
    throw new Error('passport-dapp: provisional ACC needs an absolute real asset directory');
  const digest = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  if (
    digest(join(assets, 'compiler/contract-manifest.json')) !== candidate.manifestSha256 ||
    digest(join(assets, 'contract/index.js')) !== candidate.moduleHashes?.['contract/index.js']
  )
    throw new Error('passport-dapp: provisional ACC asset bytes differ from the package pin');
  return id;
}
