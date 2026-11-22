import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectKeyProfile } from './profiles.mjs';
import { createKeyServer, loadBundle } from './server.mjs';
import { composeAccProfileManifest } from '../../../packages/contract/bin/compose-acc-profile.mjs';

const bindingId = process.env.PASSPORT_KEY_BINDING_ID ?? 'acc-s3r1.1';
if (!['acc-s3r1.1', 'acc-s3r1.1-zkir036'].includes(bindingId))
  throw new Error(`unsupported key-service binding: ${bindingId}`);
const compilerManifestSha256 = '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f';
const candidateArtefactManifestSha256 =
  '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f';
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

const keyManifestBytes = readFileSync(join(contract, `resources/${bindingId}.key-manifest.json`));
const {
  files,
  manifestBytes: compilerManifestBytes,
  provers,
} = loadBundle(
  join(contract, `resources/${bindingId}.zkir.json.gz`),
  bindingId,
  compilerManifestSha256,
  keyManifestBytes,
);
let manifestBytes = compilerManifestBytes;
if (bindingId === 'acc-s3r1.1-zkir036') {
  const packaged = readFileSync(join(contract, `resources/${bindingId}.artefact-manifest.json`));
  const derived = composeAccProfileManifest(compilerManifestBytes, keyManifestBytes);
  if (
    !packaged.equals(derived) ||
    createHash('sha256').update(packaged).digest('hex') !== candidateArtefactManifestSha256
  )
    throw new Error('candidate artifact manifest differs from the pinned key profile');
  manifestBytes = packaged;
}
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

const server = createKeyServer({
  bindingId,
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
