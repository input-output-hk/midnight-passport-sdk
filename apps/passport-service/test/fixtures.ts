import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServiceConfig } from '../src/config.ts';

/** A tiny artefact tree with a valid compiler manifest. */
export function fakeArtefacts(): { dir: string; manifestSha256: string } {
  const dir = mkdtempSync(join(tmpdir(), 'acc-art-'));
  const files: Record<string, Uint8Array> = {
    'zkir/c.bzkir': Uint8Array.of(1, 2),
    'keys/c.verifier': Uint8Array.of(3),
    'keys/c.prover': Uint8Array.of(4, 5, 6),
    'compiler/contract-info.json': new TextEncoder().encode('{"circuits":[]}'),
  };
  const node = (bytes: Uint8Array) => ({
    type: 'file',
    size: bytes.length,
    hash: createHash('sha256').update(bytes).digest('hex'),
  });
  const tree: Record<string, unknown> = { 'manifest-version': '1' };
  for (const [rel, bytes] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), bytes);
    const [folder, name] = rel.split('/') as [string, string];
    const sub = (tree[folder] ??= { type: 'directory' }) as Record<string, unknown>;
    sub[name] = node(bytes);
  }
  const manifest = JSON.stringify(tree);
  writeFileSync(join(dir, 'compiler/contract-manifest.json'), manifest);
  return { dir, manifestSha256: createHash('sha256').update(manifest).digest('hex') };
}

export function testConfig(over: Partial<ServiceConfig> = {}): ServiceConfig {
  const { dir, manifestSha256 } = fakeArtefacts();
  return {
    port: 0,
    corsOrigin: 'http://localhost:5173',
    networkId: 'undeployed',
    bindingId: 'acc-test',
    contractDir: dir,
    artefactDir: dir,
    manifestSha256,
    indexerUri: 'http://i',
    indexerWsUri: 'ws://i',
    nodeUri: 'http://n',
    proofServerUri: 'http://p',
    registryFile: join(dir, 'registry.json'),
    sponsorSeed: '00'.repeat(32),
    ...over,
  };
}
