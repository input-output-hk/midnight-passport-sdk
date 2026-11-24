// Build the exact local Ledger 9 registry profile with the released 0.36.1
// compiler. This prepares files only; it never opens a wallet or a node.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { fetchPinnedMidnamesSource } from './upstream-source.mjs';

const manifest = JSON.parse(
  readFileSync(new URL('./registry-manifest-0361.json', import.meta.url), 'utf8'),
);
const sha = (input) => createHash('sha256').update(input).digest('hex');
const verify = (path, expected) =>
  assert.equal(sha(readFileSync(path)), expected, `Artifact differs: ${path}`);
const [source, output] = process.argv.slice(2);
const fromUpstream = source === '--upstream-ledger9';
assert.ok(source && output && (fromUpstream || isAbsolute(source)) && isAbsolute(output));
assert.equal(resolve(output), output);
assert.ok(process.env.IN_NIX_SHELL, 'Use the repository Nix shell.');

const toolchain = process.env.COMPACT_0361_DIRECTORY;
assert.ok(toolchain && isAbsolute(toolchain) && resolve(toolchain) === toolchain);
assert.equal(realpathSync(toolchain), toolchain);
assert.ok(lstatSync(toolchain).isDirectory());
const compiler = join(toolchain, 'compactc');
const zkir = join(toolchain, 'zkir-v3');
assert.equal(
  execFileSync(compiler, ['--version'], { encoding: 'utf8' }).trim(),
  '0.36.1 (7fa3a117c 2026-11-11)',
);
assert.equal(execFileSync(zkir, ['--version'], { encoding: 'utf8' }).trim(), 'midnight-zkir 3.2.0');

const upstream = fromUpstream
  ? await fetchPinnedMidnamesSource(manifest)
  : readFileSync(source, 'utf8');
assert.equal(sha(upstream), manifest.sourceSha256, 'Wrong Midnames source bytes.');
const adapted = upstream.replace(
  /^pragma language_version 0\.22;/,
  'pragma language_version 0.28;',
);
assert.equal(sha(adapted), manifest.standaloneSourceSha256, 'Wrong adapted source bytes.');
mkdirSync(output, { mode: 0o700 });
const compactSource = 'ns-standalone-0.28.compact';
writeFileSync(join(output, compactSource), adapted, { flag: 'wx', mode: 0o600 });

// The full compiler run emits the pinned ZKIR and keys. A second, skip-ZK
// run produces the exact browser module used by the native 0.36.1 receipt:
// with no embedded expectedVk, the separately pinned roster stays explicit.
const full = join(output, 'managed-full');
const prepared = join(output, 'managed');
execFileSync(compiler, [compactSource, 'managed-full'], {
  cwd: output,
  stdio: 'inherit',
  timeout: 600_000,
});
execFileSync(compiler, ['--skip-zk', compactSource, 'managed'], {
  cwd: output,
  stdio: 'inherit',
  timeout: 600_000,
});
mkdirSync(join(prepared, 'keys'), { mode: 0o700 });
for (const [name, pins] of Object.entries(manifest.circuits)) {
  assert.match(name, /^[a-z_]+$/);
  verify(join(prepared, 'zkir', name + '.zkir'), pins.zkir);
  for (const kind of ['bzkir', 'prover', 'verifier']) {
    const folder = kind === 'bzkir' ? 'zkir' : 'keys';
    const from = join(full, folder, name + '.' + kind);
    verify(from, pins[kind]);
    copyFileSync(from, join(prepared, folder, name + '.' + kind));
  }
}
for (const [file, pin] of Object.entries(manifest.compiled)) verify(join(prepared, file), pin);
rmSync(full, { recursive: true });
writeFileSync(join(output, 'prepared.json'), JSON.stringify(manifest, null, 2) + '\n', {
  flag: 'wx',
  mode: 0o600,
});
