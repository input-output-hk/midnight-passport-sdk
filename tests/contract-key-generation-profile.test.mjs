import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const { createKeyServer, loadBundle } = await import(
  new URL('../apps/passport-key-service/src/server.mjs', import.meta.url).href
);
const { composeAccProfileManifest } = await import(
  new URL('../packages/contract/bin/compose-acc-profile.mjs', import.meta.url).href
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

test('candidate key service serves only its versioned verifier route', async () => {
  const candidate = manifest('acc-s3r1.1-zkir036');
  const loaded = loadBundle(
    join(packageRoot, `resources/${candidate.bindingId}.zkir.json.gz`),
    candidate.bindingId,
    candidate.compilerManifestSha256,
    readFileSync(join(packageRoot, `resources/${candidate.bindingId}.key-manifest.json`)),
  );
  const composedManifest = composeAccProfileManifest(
    loaded.manifestBytes,
    readFileSync(join(packageRoot, `resources/${candidate.bindingId}.key-manifest.json`)),
  );
  assert.equal(
    createHash('sha256').update(composedManifest).digest('hex'),
    '590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f',
  );
  assert.deepEqual(
    composedManifest,
    readFileSync(join(packageRoot, `resources/${candidate.bindingId}.artefact-manifest.json`)),
  );
  assert.throws(
    () =>
      composeAccProfileManifest(
        loaded.manifestBytes,
        readFileSync(join(packageRoot, 'resources/acc-s3r1.1.key-manifest.json')),
      ),
    /incomplete or incompatible/,
  );
  const server = createKeyServer({
    bindingId: candidate.bindingId,
    ...loaded,
    manifestBytes: composedManifest,
    keyManifestBytes: readFileSync(
      join(packageRoot, `resources/${candidate.bindingId}.key-manifest.json`),
    ),
    keyDir: packageRoot,
    profile: { name: 'test', circuits: [] },
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const path = `/v1/zk/${candidate.bindingId}/keys/${circuit}.verifier`;
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    assert.equal(
      createHash('sha256')
        .update(Buffer.from(await response.arrayBuffer()))
        .digest('hex'),
      candidate.circuits[circuit].verifier.sha256,
    );
    assert.equal((await fetch(`${base}/v1/zk/acc-s3r1.1/keys/${circuit}.verifier`)).status, 404);
    assert.equal((await fetch(`${base}/zk/acc/keys/${circuit}.verifier`)).status, 404);
    assert.deepEqual(
      Buffer.from(
        await (
          await fetch(`${base}/v1/zk/${candidate.bindingId}/compiler/contract-manifest.json`)
        ).arrayBuffer(),
      ),
      composedManifest,
    );
    assert.equal((await fetch(`${base}/v1/profile`)).status, 200);
  } finally {
    await new Promise((resolve) => server.close(() => resolve(undefined)));
  }
});
