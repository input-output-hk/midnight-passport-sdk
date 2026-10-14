import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

type ManifestNode =
  { type: 'file'; size: number; hash: string } | { type: 'directory'; [name: string]: unknown };

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Fails closed unless the manifest hash and every listed file match (spec §6; Review Focus 3). */
export function verifyArtefacts(dir: string, manifestSha256: string): void {
  const manifestBytes = readFileSync(join(dir, 'compiler/contract-manifest.json'));
  if (sha256(manifestBytes) !== manifestSha256)
    throw new Error('artefact manifest hash does not match the pinned value');
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [name, value] of Object.entries(node)) {
      if (!value || typeof value !== 'object') continue;
      const entry = value as ManifestNode;
      const rel = `${prefix}${name}`;
      if (entry.type === 'file') {
        const path = join(dir, rel);
        if (statSync(path).size !== entry.size || sha256(readFileSync(path)) !== entry.hash) {
          throw new Error(`artefact ${rel} does not match the manifest`);
        }
      } else if (entry.type === 'directory') {
        walk(entry as Record<string, unknown>, `${rel}/`);
      }
    }
  };
  walk(JSON.parse(manifestBytes.toString('utf8')) as Record<string, unknown>, '');
}

/**
 * The circuits the binding can prove: those with both a prover key and a compiled ZKIR in the
 * compiler manifest. The manifest is the authority because it is pinned by hash and every file
 * in it is verified at start-up (`verifyArtefacts`), whereas `contract-info.json` also lists the
 * pure circuits, which have no keys and are never proved. Call it after `verifyArtefacts`.
 */
export function bindingCircuits(dir: string): Set<string> {
  const manifest = JSON.parse(
    readFileSync(join(dir, 'compiler/contract-manifest.json'), 'utf8'),
  ) as Record<string, unknown>;
  const names = (folder: string, suffix: string): Set<string> => {
    const out = new Set<string>();
    const node = manifest[folder];
    if (!node || typeof node !== 'object') return out;
    for (const [name, value] of Object.entries(node as Record<string, unknown>)) {
      const entry = value as { type?: unknown } | null;
      if (name.endsWith(suffix) && entry?.type === 'file') out.add(name.slice(0, -suffix.length));
    }
    return out;
  };
  const zkir = names('zkir', '.bzkir');
  return new Set([...names('keys', '.prover')].filter((circuit) => zkir.has(circuit)));
}
