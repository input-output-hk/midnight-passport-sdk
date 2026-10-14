import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectKeyProfile } from './profiles.mjs';
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
const corsOrigins = (process.env.PASSPORT_KEY_CORS_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
for (const origin of corsOrigins) {
  const parsed = new URL(origin);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin)
    throw new Error(`invalid CORS origin: ${origin}`);
}

const { files, manifestBytes, provers } = loadBundle(
  join(contract, `resources/${bindingId}.zkir.json.gz`),
  bindingId,
  manifestSha256,
);
const profile = selectKeyProfile(process.env.PASSPORT_KEY_PROFILE ?? 'all', provers);

// The pinned CLI validates the bundle and every restored key before the HTTP socket opens.
// Reusing a persistent cache verifies its existing keys; it never silently replaces a mismatch.
const restored = spawnSync(
  process.execPath,
  [
    join(contract, 'bin/restore-acc-keys.mjs'),
    '--binding',
    bindingId,
    '--output',
    keyDir,
    ...(profile.name === 'all' ? [] : ['--circuits', profile.circuits.join(',')]),
  ],
  { stdio: 'inherit' },
);
if (restored.error) throw restored.error;
if (restored.status !== 0) throw new Error(`key restoration failed (${restored.status})`);

const keyManifestBytes = readFileSync(join(contract, `resources/${bindingId}.key-manifest.json`));
const server = createKeyServer({
  files,
  manifestBytes,
  keyManifestBytes,
  provers,
  keyDir,
  profile,
  corsOrigins,
});
server.listen(port, host, () => {
  console.log(`passport-key-service: ${bindingId}/${profile.name} ready at http://${host}:${port}`);
});
