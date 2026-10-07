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
