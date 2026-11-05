/** Lightweight metadata only: importing this entry never loads the generated ACC or runtime. */
import { catalog } from './capabilities.generated.js';

export interface AccCircuitCapability {
  readonly name: string;
  readonly kind: 'proof' | 'pure';
  readonly scheme: 'JubJub' | 'P-256' | 'k256' | 'common';
  readonly maturity: 'preview' | 'experimental';
  readonly inputs: readonly string[];
  readonly witnesses: readonly string[];
  readonly authority: string;
  readonly consent: string;
  readonly flowOwner: string;
  readonly support:
    | 'typed flow'
    | 'holder flow'
    | 'service flow'
    | 'sender port'
    | 'scope helper'
    | 'key helper'
    | 'binding only'
    | 'artifact only';
  /** Test definitions, not proof that a native/browser/provider run passed. */
  readonly testEvidence: readonly string[];
  readonly keyProfiles: readonly ('all' | 'jubjub-owner-v1')[];
}

export interface AccCapabilityCatalog {
  readonly schemaVersion: 1;
  readonly binding: {
    readonly id: 'acc-s3r1.1';
    readonly sourceRevision: string;
    readonly compilerManifestSha256: string;
    readonly moduleSha256: string;
    readonly compiler: string;
    readonly runtime: string;
  };
  readonly evidencePolicy: Readonly<Record<string, string>>;
  readonly circuits: readonly AccCircuitCapability[];
}

function freeze(value: object): void {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') freeze(child as object);
  }
  Object.freeze(value);
}
freeze(catalog);

/** Immutable support inventory for this SDK candidate and the unchanged ACC binding. */
export const ACC_CAPABILITIES: AccCapabilityCatalog = catalog;

/** Unknown names/kinds have no capability; no fallback or inferred circuit support. */
export function getAccCircuitCapability(
  name: string,
  kind: AccCircuitCapability['kind'],
): AccCircuitCapability | undefined {
  return ACC_CAPABILITIES.circuits.find((entry) => entry.name === name && entry.kind === kind);
}

export { inspectAccProofProfile } from './proof-profile.js';
export type { AccProofProfileIssue, AccProofProfileReport } from './proof-profile.js';
