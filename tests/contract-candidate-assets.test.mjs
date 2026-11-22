import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { stageAccCandidateAssets } from '../packages/contract/bin/stage-acc-candidate-assets.mjs';

const packageRoot = new URL('../packages/contract/', import.meta.url);
/** @param {Uint8Array} bytes */
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('candidate staging refuses absent provers and preserves both inputs and the output path', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'passport-candidate-assets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceDir = join(root, 'source'),
    keyDir = join(root, 'candidate-keys'),
    outputDir = join(root, 'candidate-assets');
  mkdirSync(join(sourceDir, 'compiler'), { recursive: true });
  mkdirSync(keyDir);
  const bundle = JSON.parse(
    gunzipSync(
      readFileSync(new URL('resources/acc-s3r1.1-zkir036.zkir.json.gz', packageRoot)),
    ).toString('utf8'),
  );
  const manifest = JSON.parse(bundle.manifest);
  writeFileSync(join(sourceDir, 'compiler/contract-manifest.json'), bundle.manifest);
  const generated = new URL('generated/acc-s3r1.1/', packageRoot);
  for (const folder of ['compiler', 'contract', 'zkir']) {
    mkdirSync(join(sourceDir, folder), { recursive: true });
    for (const [name, pin] of Object.entries(manifest[folder])) {
      if (name === 'type') continue;
      const bytes =
        folder === 'zkir'
          ? Buffer.from(bundle.files[`zkir/${name}`], 'base64')
          : readFileSync(new URL(folder === 'compiler' ? 'contract-info.json' : name, generated));
      assert.equal(bytes.length, pin.size);
      assert.equal(sha256(bytes), pin.hash);
      writeFileSync(join(sourceDir, folder, name), bytes);
    }
  }
  for (const [name, encoded] of Object.entries(bundle.files)) {
    if (name.startsWith('keys/'))
      writeFileSync(join(keyDir, name.slice(5)), Buffer.from(encoded, 'base64'));
  }
  await assert.rejects(
    stageAccCandidateAssets({ sourceDir, keyDir, outputDir }),
    /keys\/activate_initial_device_with_jubjub\.prover/,
  );
  assert.equal(existsSync(outputDir), false);
  assert.equal(
    readdirSync(root).some((name) => name.startsWith('.candidate-assets-stage-')),
    false,
  );
  assert.equal(
    sha256(readFileSync(join(sourceDir, 'compiler/contract-manifest.json'))),
    '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  );
  if (process.platform === 'darwin') {
    await assert.rejects(
      stageAccCandidateAssets({ sourceDir, keyDir, outputDir, requireReflink: true }),
      /keys\/activate_initial_device_with_jubjub\.prover/,
    );
    assert.equal(existsSync(outputDir), false);
  }
  await assert.rejects(
    stageAccCandidateAssets({ sourceDir, keyDir, outputDir: join(sourceDir, 'nested') }),
    /output exists or is inside an input tree/,
  );
  symlinkSync(join(root, 'missing-target'), outputDir);
  await assert.rejects(
    stageAccCandidateAssets({ sourceDir, keyDir, outputDir }),
    /output exists or is inside an input tree/,
  );
  assert.equal(lstatSync(outputDir).isSymbolicLink(), true);
  unlinkSync(outputDir);
  mkdirSync(outputDir);
  await assert.rejects(
    stageAccCandidateAssets({ sourceDir, keyDir, outputDir }),
    /output exists or is inside an input tree/,
  );
  assert.equal(lstatSync(outputDir).isDirectory(), true);
  rmdirSync(outputDir);
  writeFileSync(join(sourceDir, 'compiler/contract-manifest.json'), bundle.manifest + ' ');
  await assert.rejects(
    stageAccCandidateAssets({ sourceDir, keyDir, outputDir }),
    /source compiler manifest differs/,
  );
  assert.equal(existsSync(outputDir), false);
});
