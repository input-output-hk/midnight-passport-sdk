import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKeyServer, loadBundle } from './server.mjs';

const bindingId = 'acc-s3r1.1';
const manifestSha256 = '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const contract = join(root, 'packages/contract');
const keyDir = resolve(process.env.PASSPORT_KEY_DIR ?? '/data/keys');
const host = process.env.PASSPORT_KEY_HOST ?? '0.0.0.0';
const port = Number(process.env.PASSPORT_KEY_PORT ?? '8788');
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('invalid key-service port');

// The pinned CLI validates the bundle and every restored key before the HTTP socket opens.
// Reusing a persistent cache verifies its existing keys; it never silently replaces a mismatch.
const restored = spawnSync(
  process.execPath,
  [join(contract, 'bin/restore-acc-keys.mjs'), '--binding', bindingId, '--output', keyDir],
  { stdio: 'inherit' },
);
if (restored.error) throw restored.error;
if (restored.status !== 0) throw new Error(`key restoration failed (${restored.status})`);

const { files, manifestBytes, provers } = loadBundle(
  join(contract, `resources/${bindingId}.zkir.json.gz`),
  bindingId,
  manifestSha256,
);
const keyManifestBytes = readFileSync(join(contract, `resources/${bindingId}.key-manifest.json`));
const server = createKeyServer({ files, manifestBytes, keyManifestBytes, provers, keyDir });
server.listen(port, host, () => {
  console.log(`passport-key-service: ${bindingId} ready at http://${host}:${port}`);
});
