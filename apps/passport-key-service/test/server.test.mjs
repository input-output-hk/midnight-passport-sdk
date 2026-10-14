import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { createKeyServer, loadBundle } from '../src/server.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const dir = mkdtempSync(join(tmpdir(), 'passport-keys-test-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const zkir = Buffer.from('circuit');
const verifier = Buffer.from('verify');
const prover = Buffer.from('prover-key');
const pin = (bytes) => ({ type: 'file', size: bytes.length, hash: hash(bytes) });
const manifestBytes = Buffer.from(
  JSON.stringify({
    'compiler-version': '0.35.0',
    'manifest-version': '1',
    zkir: { type: 'directory', 'c.zkir': pin(zkir) },
    keys: { type: 'directory', 'c.verifier': pin(verifier), 'c.prover': pin(prover) },
  }),
);
const bundle = {
  schemaVersion: 1,
  bindingId: 'acc-s3r1.1',
  manifest: manifestBytes.toString(),
  files: { 'zkir/c.zkir': zkir.toString('base64'), 'keys/c.verifier': verifier.toString('base64') },
};
const bundlePath = join(dir, 'bundle.gz');
writeFileSync(bundlePath, gzipSync(JSON.stringify(bundle)));
writeFileSync(join(dir, 'c.prover'), prover);

test('bundle is checked against its independent manifest pin and every served input', () => {
  const loaded = loadBundle(bundlePath, bundle.bindingId, hash(manifestBytes));
  assert.equal(loaded.provers.size, 1);
  assert.equal(loaded.files.get('zkir/c.zkir').toString(), 'circuit');
  assert.throws(() => loadBundle(bundlePath, bundle.bindingId, '0'.repeat(64)), /hash mismatch/);
  writeFileSync(
    bundlePath,
    gzipSync(JSON.stringify({ ...bundle, files: { ...bundle.files, 'zkir/c.zkir': 'YQ==' } })),
  );
  assert.throws(() => loadBundle(bundlePath, bundle.bindingId, hash(manifestBytes)), /differs/);
  writeFileSync(bundlePath, gzipSync(JSON.stringify(bundle)));
});

test('server streams pinned keys with ranges and rejects unknown paths', async () => {
  const loaded = loadBundle(bundlePath, bundle.bindingId, hash(manifestBytes));
  const server = createKeyServer({ ...loaded, keyManifestBytes: Buffer.from('{}'), keyDir: dir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const full = await fetch(`${base}/zk/acc/keys/c.prover`);
  assert.equal(full.status, 200);
  assert.equal(await full.text(), 'prover-key');
  const part = await fetch(`${base}/zk/acc/keys/c.prover`, { headers: { range: 'bytes=2-5' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await part.text(), 'over');
  assert.equal((await fetch(`${base}/zk/acc/keys/other.prover`)).status, 404);
  assert.equal((await fetch(`${base}/zk/acc/%2e%2e/secret`)).status, 404);
  assert.equal(
    (await fetch(`${base}/zk/acc/keys/c.prover`, { headers: { range: 'bytes=99-' } })).status,
    416,
  );
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/v1/manifest`)).status, 200);
});
