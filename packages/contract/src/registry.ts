// Resolution logic over the generated binding registry (FS-0.2 §4.1, D-8).
// The registry is contract-package data; WHICH version a given account uses
// is kernel-owned account metadata (core, via the Storage seam) — this
// package only defines, resolves, and detects versions. Browser-safe by
// construction: no platform imports (the boundary lint enforces it).
import {
  ACC_REGISTRY as GENERATED_REGISTRY,
  type AccBinding,
  type AccRegistry,
} from './manifest.generated.js';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/**
 * The pinned-version registry, deep-frozen at initialisation. The
 * freeze is not incidental: this data is the integrity anchor the loader
 * (T3) verifies artefact bytes against, so it must be immutable before any
 * consumer can hold a reference — `readonly` types are compile-time only.
 * The generated module is data-only by design (no logic in generated
 * files), so applying the invariant is this module's job, and the package
 * exposes the registry solely through here (the exports map publishes only
 * the package entrypoint), so no unfrozen reference can escape.
 */
export const ACC_REGISTRY: AccRegistry = deepFreeze(GENERATED_REGISTRY);

/** The version new deploys use (the registry's `current` pointer). */
export const BINDING_VERSION: string = ACC_REGISTRY.current;

/** Every binding version this SDK release can serve (architecture §8 decision 2's supported range). */
const supportedBindings = (registry: AccRegistry): string[] =>
  Object.entries(registry.versions)
    .filter(([, binding]) => !binding.provisional)
    .map(([version]) => version);
export const SUPPORTED_BINDINGS: readonly string[] = Object.freeze(supportedBindings(ACC_REGISTRY));

/**
 * Thrown when a version outside the supported set is resolved (FS-0.2 D-8).
 * Discriminate on {@link UnsupportedBindingError.code}, which is stable.
 */
export class UnsupportedBindingError extends Error {
  override readonly name = 'UnsupportedBindingError';
  /** The stable machine-readable discriminant in the SDK error taxonomy. */
  readonly code = 'UNSUPPORTED_BINDING';
  constructor(
    /** The version that was requested and is not supported. */
    readonly version: string,
    supported: readonly string[] = SUPPORTED_BINDINGS,
  ) {
    super(
      `Binding version "${version}" is not supported by this SDK release — ` +
        `supported: ${supported.join(', ')} (FS-0.2 D-8).`,
    );
  }
}

/**
 * The full pinned entry, including provisional source candidates; throws
 * {@link UnsupportedBindingError} for unknown IDs (own properties only —
 * prototype keys such as "__proto__" are rejected). A pin is not SDK
 * admission; normal consumers use {@link resolveBinding}. The returned entry
 * is frozen and shared.
 */
export function resolvePinnedBinding(
  version: string,
  registry: AccRegistry = ACC_REGISTRY,
): AccBinding {
  const binding = Object.hasOwn(registry.versions, version)
    ? registry.versions[version]
    : undefined;
  if (!binding) throw new UnsupportedBindingError(version, supportedBindings(registry));
  return binding;
}

/** Resolve a supported binding; provisional pins remain available only to explicit host qualification. */
export function resolveBinding(version: string, registry: AccRegistry = ACC_REGISTRY): AccBinding {
  const binding = resolvePinnedBinding(version, registry);
  if (binding.provisional) throw new UnsupportedBindingError(version, supportedBindings(registry));
  return binding;
}

const normaliseHash = (hash: string) => hash.toLowerCase().replace(/^0x/, '');

/**
 * Matches a deployed contract's verifier-key hashes against every pinned
 * version — the chain-derived answer to "which version is this account?"
 * while the ACC carries no on-chain version marker (FS-0.2 OQ-7). Input
 * hashes are normalised (lowercased, `0x` prefix stripped) and compared as
 * a deduplicated set with strict equality — subsets and supersets return
 * null. Limits, recorded in the security register: versions differing only
 * in pure circuits or module bytes are indistinguishable, and the
 * circuit-to-key assignment is not checked. Ties prefer `current`, then
 * the lexicographically first pinned version. Use {@link resolveBinding} after
 * detection before admitting an account.
 */
export function detectDeployedVersion(
  onChainVerifierKeyHashes: readonly string[],
  registry: AccRegistry = ACC_REGISTRY,
): string | null {
  const observed = [...new Set(onChainVerifierKeyHashes.map(normaliseHash))].sort();
  if (observed.length === 0) return null;
  const matches = Object.entries(registry.versions)
    .filter(([, binding]) => {
      const known = [
        ...new Set(
          Object.values(binding.circuits).flatMap((pin) =>
            pin.hashes ? [pin.hashes.verifierKey] : [],
          ),
        ),
      ].sort();
      return known.length === observed.length && known.every((h, i) => h === observed[i]);
    })
    .map(([version]) => version);
  if (matches.length === 0) return null;
  return matches.includes(registry.current) ? registry.current : (matches[0] ?? null);
}

/**
 * Detect a binding from the complete on-chain circuit-to-verifier assignment.
 * Use this for account admission when more than one key-generation profile may
 * have the same hash set: a permutation of verifier keys is not a valid ACC
 * binding even if {@link detectDeployedVersion} matches the unordered set.
 */
export function detectDeployedVersionByCircuit(
  onChainVerifierKeyHashes: Readonly<Record<string, string>>,
  registry: AccRegistry = ACC_REGISTRY,
): string | null {
  const observed = Object.entries(onChainVerifierKeyHashes)
    .map(([name, hash]) => [name, typeof hash === 'string' ? normaliseHash(hash) : ''] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  if (
    observed.length === 0 ||
    observed.some(([name, hash]) => !/^[a-z][a-z0-9_]*$/.test(name) || !/^[a-f0-9]{64}$/.test(hash))
  )
    return null;
  const matches = Object.entries(registry.versions)
    .filter(([, binding]) => {
      const expected = Object.entries(binding.circuits)
        .flatMap(([name, pin]) => (pin.hashes ? [[name, pin.hashes.verifierKey] as const] : []))
        .sort(([a], [b]) => a.localeCompare(b));
      return (
        expected.length === observed.length &&
        expected.every(
          ([name, hash], index) => name === observed[index]?.[0] && hash === observed[index]?.[1],
        )
      );
    })
    .map(([version]) => version);
  if (matches.length === 0) return null;
  return matches.includes(registry.current) ? registry.current : (matches[0] ?? null);
}

/**
 * The connect-time compatibility guard (architecture §8 decision 2): the
 * SDK serves an account only if its binding version is in the supported
 * set — otherwise it throws {@link UnsupportedBindingError}. The same
 * check as {@link resolveBinding}, kept as a named guard so call sites
 * read as the gate they are.
 */
export function assertBindingCompatible(
  version: string,
  registry: AccRegistry = ACC_REGISTRY,
): void {
  resolveBinding(version, registry);
}
