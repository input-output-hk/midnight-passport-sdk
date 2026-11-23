import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.ok(process.env.IN_NIX_SHELL, 'Run through the pinned Nix shell.');
const [suffix, prepared, reference, candidateAssets] = process.argv.slice(2);
assert.match(suffix ?? '', /^[a-z0-9]{1,16}$/);
for (const path of [prepared, reference, candidateAssets]) {
  assert.ok(path && path.startsWith('/') && realpathSync(path) === path);
}
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
assert.equal(
  execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
  '',
  'Sign and commit the qualification source before running.',
);
const output = join(root, 'review', `midnames-candidate-key-refusals-${suffix}`);
assert.equal(existsSync(output), false, 'Use a fresh evidence name.');
mkdirSync(output, { mode: 0o700 });
const mirror = join(output, 'candidate-assets');
const bin = join(output, 'bin');
mkdirSync(mirror, { mode: 0o700 });
mkdirSync(bin, { mode: 0o700 });
// A regression in the pre-stack guard must stop at this shim, not create a chain.
writeFileSync(join(bin, 'docker'), '#!/bin/sh\necho unexpected-docker-access >&2\nexit 99\n', {
  mode: 0o700,
  flag: 'wx',
});
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const lease = join(
  process.env.HOME,
  '.midnight-passport-native-qualification/mn-passport-qual-20261023-published-native.lock',
);
assert.equal(existsSync(lease), false, 'The native lease is already held.');
const missing = 'keys/deposit_unshielded.prover';
const originalKey = join(candidateAssets, missing);
const originalKeySha256 = sha(readFileSync(originalKey));
const keySize = statSync(originalKey).size;
const linkTree = (from, to, prefix = '') => {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const sourcePath = join(from, entry.name);
    const targetPath = join(to, entry.name);
    if (entry.isDirectory()) {
      mkdirSync(targetPath, { mode: 0o700 });
      linkTree(sourcePath, targetPath, rel);
    } else {
      assert.ok(entry.isFile(), `The candidate tree contains an unexpected ${rel}.`);
      if (rel !== missing) symlinkSync(sourcePath, targetPath);
    }
  }
};
linkTree(candidateAssets, mirror);
const receipt = {
  schemaVersion: 1,
  kind: 'candidate-key-native-supervisor-prestack-refusals',
  sourceHead: source,
  status: 'RUNNING',
  originalKeySha256,
  cases: [],
};
const save = () =>
  writeFileSync(join(output, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
    mode: 0o600,
  });
save();
const run = (name, assets, expected) => {
  const runName = `midnames-night-candidate-379-key-${name}-${suffix}`;
  const nativeOutput = join(root, 'review', runName);
  assert.equal(existsSync(nativeOutput), false);
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'examples/midnames-local/qualify-deposit.mjs'),
      runName,
      prepared,
      reference,
      '10.254.96.0/28',
    ],
    {
      cwd: root,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        PASSPORT_MIDNAMES_NATIVE: '1',
        PASSPORT_RC_LOCALNET: '1',
        PASSPORT_MIDNAMES_CANDIDATE_ASSETS: assets,
      },
      encoding: 'utf8',
      timeout: 300_000,
      maxBuffer: 2 * 1024 * 1024,
    },
  );
  const stderr = result.stderr ?? '';
  writeFileSync(join(output, `${name}.stderr.private.txt`), stderr, {
    mode: 0o600,
    flag: 'wx',
  });
  assert.equal(result.error, undefined, `${name} timed out or could not start.`);
  assert.notEqual(result.status, 0, `${name} was admitted unexpectedly.`);
  assert.match(stderr, expected);
  assert.doesNotMatch(stderr, /unexpected-docker-access/);
  assert.equal(existsSync(nativeOutput), false, `${name} allocated a native output.`);
  assert.equal(existsSync(lease), false, `${name} acquired the native lease.`);
  const row = { name, exitCode: result.status, stderrSha256: sha(Buffer.from(stderr)) };
  receipt.cases.push(row);
  save();
  return row;
};
try {
  run('missing', mirror, /ENOENT.*deposit_unshielded\.prover/);
  writeFileSync(join(mirror, missing), Buffer.alloc(keySize), { mode: 0o600, flag: 'wx' });
  assert.equal(lstatSync(join(mirror, missing)).isFile(), true);
  run('corrupt', mirror, /artefact keys\/deposit_unshielded\.prover does not match the manifest/);
  run(
    'wrongbinding',
    join(reference, 'contracts/managed/account'),
    /artefact manifest hash does not match the pinned value/,
  );
  assert.equal(sha(readFileSync(originalKey)), originalKeySha256);
  receipt.status = 'PASS';
  receipt.guard = 'No case reached Docker, native allocation, or lease acquisition.';
  save();
  rmSync(mirror, { recursive: true });
  console.log(JSON.stringify({ status: receipt.status, sourceHead: source, cases: receipt.cases }));
} catch (error) {
  receipt.status = 'FAIL';
  receipt.error = String(error);
  save();
  throw error;
}
