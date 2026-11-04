import { catalog } from './capabilities.generated.js';

export interface AccProofProfileIssue {
  readonly code:
    | 'InvalidProfile'
    | 'InvalidRequirements'
    | 'ManifestMismatch'
    | 'MissingProver'
    | 'MissingVerifier';
  readonly path: string;
  readonly message: string;
}
export interface AccProofProfileReport {
  readonly evidence: 'advertised-metadata-only';
  readonly status: 'profile-incomplete' | 'profile-covers-request';
  readonly requiredCircuits: readonly string[];
  readonly issues: readonly AccProofProfileIssue[];
  readonly runtimeChecks: readonly string[];
}

/** JSON responses are untrusted data. Reject accessors and avoid user diagnostic reflection. */
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
const known = new Set(catalog.circuits.filter((c) => c.kind === 'proof').map((c) => c.name));

/**
 * Check /v1/profile and /v1/manifest responses against the packaged binding and an explicit
 * requested proof set. No fetch, generation, file hashing, credential or proof is performed.
 * A profile name, all verifiers or /healthz success cannot substitute for required provers.
 * Supply parsed JSON/trusted data objects, not proxies with executable reflection traps.
 */
export function inspectAccProofProfile(
  profile: unknown,
  manifest: unknown,
  requiredCircuits: readonly string[],
): AccProofProfileReport {
  const issues: AccProofProfileIssue[] = [];
  const add = (code: AccProofProfileIssue['code'], path: string, message: string) =>
    issues.push(Object.freeze({ code, path, message }));
  const names = (value: unknown, path: string): Set<string> => {
    // The fixed binding has 52 proof circuits; bound malformed advertisements before walking.
    if (!Array.isArray(value) || value.length > known.size) {
      add('InvalidProfile', path, 'Expected a bounded list of pinned proof circuit names.');
      return new Set();
    }
    const result = new Set<string>();
    for (let index = 0; index < value.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      const item: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
      if (typeof item !== 'string' || !known.has(item) || result.has(item))
        add(
          'InvalidProfile',
          `${path}.${index}`,
          'Unknown, duplicate or absent pinned proof circuit.',
        );
      else result.add(item);
    }
    return result;
  };
  if (
    field(manifest, 'bindingId') !== catalog.binding.id ||
    field(manifest, 'compilerManifestSha256') !== catalog.binding.compilerManifestSha256
  )
    add(
      'ManifestMismatch',
      'manifest',
      'Advertised manifest identity differs from the packaged ACC pin.',
    );
  const requested = new Set<string>();
  if (
    !Array.isArray(requiredCircuits) ||
    requiredCircuits.length === 0 ||
    requiredCircuits.length > known.size
  )
    add(
      'InvalidRequirements',
      'requiredCircuits',
      'Provide a nonempty bounded explicit proof circuit set.',
    );
  else
    for (let index = 0; index < requiredCircuits.length; index++) {
      const descriptor = Object.getOwnPropertyDescriptor(requiredCircuits, String(index));
      const item: unknown = descriptor && 'value' in descriptor ? descriptor.value : undefined;
      if (typeof item !== 'string' || !known.has(item))
        add(
          'InvalidRequirements',
          `requiredCircuits.${index}`,
          'The requested circuit is not a pinned proof circuit.',
        );
      else requested.add(item);
    }
  const provers = names(field(profile, 'circuits'), 'profile.circuits');
  const verifiers = names(field(profile, 'verifierCircuits'), 'profile.verifierCircuits');
  for (const name of [...requested].sort()) {
    if (!provers.has(name))
      add(
        'MissingProver',
        `profile.circuits.${name}`,
        'The requested prover is not advertised by this endpoint.',
      );
    if (!verifiers.has(name))
      add(
        'MissingVerifier',
        `profile.verifierCircuits.${name}`,
        'The requested verifier is not advertised by this endpoint.',
      );
  }
  return Object.freeze({
    evidence: 'advertised-metadata-only',
    status: issues.length ? 'profile-incomplete' : 'profile-covers-request',
    requiredCircuits: Object.freeze([...requested].sort()),
    issues: Object.freeze(issues),
    runtimeChecks: Object.freeze([
      'Authenticate the endpoint and independently verify the manifest and every consumed key byte/hash.',
      'Metadata can become stale; missing downloads, proof failure or changed configuration must still refuse.',
      'Deployment and application caller contracts have separate artifact requirements.',
      'Profile coverage is not owner authority, value funding, native admission or browser/provider qualification.',
    ]),
  });
}
