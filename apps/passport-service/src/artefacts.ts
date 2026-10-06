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
