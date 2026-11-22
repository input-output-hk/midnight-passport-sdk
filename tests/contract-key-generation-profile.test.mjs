import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const { loadBundle } = await import(
  new URL('../apps/passport-key-service/src/server.mjs', import.meta.url).href
);

const packageRoot = fileURLToPath(new URL('../packages/contract/', import.meta.url));
const restore = join(packageRoot, 'bin/restore-acc-keys.mjs');
const circuit = 'add_device_with_k256';
/** @param {string} file */
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
/** @param {string} binding */
const manifest = (binding) =>
  JSON.parse(readFileSync(join(packageRoot, `resources/${binding}.key-manifest.json`), 'utf8'));

test('old and alternate key profiles restore their independently pinned bytes', () => {
  const original = manifest('acc-s3r1.1');
  const alternate = manifest('acc-s3r1.1-zkir036');
  assert.equal(original.compilerManifestSha256, alternate.compilerManifestSha256);
  assert.equal(original.regeneration.toolchainVersion, '0.35.0');
  assert.equal(alternate.regeneration.toolchainVersion, '0.36.1');
  assert.notEqual(
    original.circuits[circuit].prover.sha256,
    alternate.circuits[circuit].prover.sha256,
  );
  const bundlePath = join(packageRoot, 'resources/acc-s3r1.1-zkir036.zkir.json.gz');
  const keyManifestBytes = readFileSync(
    join(packageRoot, 'resources/acc-s3r1.1-zkir036.key-manifest.json'),
  );
  const loaded = loadBundle(
    bundlePath,
    alternate.bindingId,
    alternate.compilerManifestSha256,
    keyManifestBytes,
  );
  assert.equal(
    loaded.provers.get(`${circuit}.prover`).hash,
    alternate.circuits[circuit].prover.sha256,
  );
  assert.equal(
    createHash('sha256')
      .update(loaded.files.get(`keys/${circuit}.verifier`))
      .digest('hex'),
    alternate.circuits[circuit].verifier.sha256,
  );
  assert.throws(
    () =>
      loadBundle(
        bundlePath,
        alternate.bindingId,
        alternate.compilerManifestSha256,
        readFileSync(join(packageRoot, 'resources/acc-s3r1.1.key-manifest.json')),
      ),
    /key manifest does not match/,
  );
  assert.notEqual(
    original.circuits[circuit].verifier.sha256,
    alternate.circuits[circuit].verifier.sha256,
  );

  const scratch = mkdtempSync(join(tmpdir(), 'passport-key-profiles-'));
  try {
    for (const [binding, pins] of [
      ['acc-s3r1.1', original],
      ['acc-s3r1.1-zkir036', alternate],
    ]) {
      const output = join(scratch, binding);
      const args = [restore, '--binding', binding, '--output', output, '--circuit', circuit];
      const first = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 120_000 });
      assert.equal(first.status, 0, `${binding}: ${first.stderr}`);
      for (const kind of ['prover', 'verifier']) {
        const file = join(output, `${circuit}.${kind}`);
        assert.equal(sha256(file), pins.circuits[circuit][kind].sha256);
      }
      const repeat = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 120_000 });
      assert.equal(repeat.status, 0, `${binding}: ${repeat.stderr}`);
      assert.match(repeat.stdout, /verified existing keys/);

      const prover = join(output, `${circuit}.prover`);
      writeFileSync(prover, Buffer.of(0xff));
      const corrupt = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 120_000 });
      assert.notEqual(corrupt.status, 0);
      assert.match(corrupt.stderr, /existing key differs from the pinned manifest/);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
