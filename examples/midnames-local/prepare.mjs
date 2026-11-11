// Builds a disposable local profile from reviewed inputs. No node, wallet or network operations.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

const manifest = JSON.parse(
  readFileSync(new URL('./registry-manifest.json', import.meta.url), 'utf8'),
);
const sha = (/** @type {Uint8Array|string} */ input) =>
  createHash('sha256').update(input).digest('hex');
const verify = (/** @type {string} */ path, /** @type {string} */ expected) =>
  assert.equal(sha(readFileSync(path)), expected, `Artifact differs: ${path}`);
const [source, output] = process.argv.slice(2);
assert.ok(source && output && isAbsolute(source) && isAbsolute(output));
assert.equal(resolve(output), output);
assert.ok(process.env.IN_NIX_SHELL && process.env.COMPACT_DIRECTORY, 'Use the pinned Nix shell');
const compiler = readlinkSync(join(process.env.COMPACT_DIRECTORY, 'bin', 'compactc'));
assert.match(compiler, /\/versions\/0\.35\.0\//);

const upstream = readFileSync(source, 'utf8');
assert.equal(sha(upstream), manifest.sourceSha256, 'Wrong Midnames source bytes');
const adapted = upstream.replace(
  /^pragma language_version 0\.22;/,
  'pragma language_version 0.27;',
);
assert.equal(sha(adapted), manifest.standaloneSourceSha256, 'Wrong adapted source bytes');
mkdirSync(output, { mode: 0o700 });
const compactSource = join(output, 'ns-standalone-0.27.compact');
const compiled = join(output, 'managed');
writeFileSync(compactSource, adapted, { flag: 'wx', mode: 0o600 });
execFileSync('compact', ['compile', '--feature-zkir-v3', 'ns-standalone-0.27.compact', 'managed'], {
  cwd: output,
  stdio: 'inherit',
  timeout: 600_000,
});
for (const [file, pin] of Object.entries(manifest.compiled))
  verify(join(compiled, file), String(pin));
const keys = join(compiled, 'keys');
for (const [name, pins] of Object.entries(manifest.circuits)) {
  assert.match(name, /^[a-z_]+$/);
  verify(join(compiled, 'zkir', name + '.zkir'), pins.zkir);
  verify(join(compiled, 'zkir', name + '.bzkir'), pins.bzkir);
  verify(join(keys, name + '.prover'), pins.prover);
  verify(join(keys, name + '.verifier'), pins.verifier);
}
writeFileSync(join(output, 'prepared.json'), JSON.stringify(manifest, null, 2) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
