#!/usr/bin/env node
// Compile the actual Lace PR contract seam sources against packed SDK tarballs.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const laceHead = '05e1e3d641a329d20c8272f6405e54ea499d86a1';
const laceCheckout = process.env.LACE_CHECKOUT;
if (!laceCheckout) throw new Error('set LACE_CHECKOUT to the checkout of Lace PR #2845');
const actualHead = execFileSync('git', ['-C', laceCheckout, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
if (actualHead !== laceHead) throw new Error(`Lace HEAD ${actualHead} differs from ${laceHead}`);
const source = join(laceCheckout, 'packages/contract/passport/src');
execFileSync('git', [
  '-C',
  laceCheckout,
  'diff',
  '--quiet',
  'HEAD',
  '--',
  'packages/contract/passport/src',
]);
const root = resolve(import.meta.dirname, '..');
const tarballs = resolve(process.env.RELEASE_TARBALL_DIR ?? join(root, 'release-tarballs'));
/** @type {{version: string, files: Array<{name: string, file: string, sha256: string}>}} */
const manifest = JSON.parse(readFileSync(join(tarballs, 'manifest.json'), 'utf8'));
if (manifest.files?.length !== 9 || manifest.version !== process.env.RELEASE_VERSION)
  throw new Error('release manifest must contain nine tarballs at RELEASE_VERSION');
const dependencies = Object.fromEntries(
  manifest.files.map(({ name, file, sha256 }) => {
    const path = join(tarballs, file);
    if (!existsSync(path)) throw new Error(`missing ${path}`);
    const actualSha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
    if (actualSha256 !== sha256) throw new Error(`tarball hash mismatch: ${file}`);
    return [name, `file:${path}`];
  }),
);
const scratch = mkdtempSync(join(tmpdir(), 'mn-passport-lace-source-'));
try {
  const laceSource = join(scratch, 'lace-contract');
  mkdirSync(laceSource);
  for (const name of ['types.ts', 'grants.ts', 'errors.ts'])
    cpSync(join(source, name), join(laceSource, name), { recursive: true, force: true });
  cpSync(join(source, 'value-objects'), join(laceSource, 'value-objects'), { recursive: true });
  cpSync(join(root, 'tests/fixtures/lace-source-consumer.ts'), join(scratch, 'consumer.ts'));
  writeFileSync(
    join(scratch, 'package.json'),
    JSON.stringify({
      name: 'mn-passport-lace-source-consumer',
      private: true,
      type: 'module',
      dependencies: { ...dependencies, 'ts-custom-error': '3.3.1', 'type-fest': '4.41.0' },
      devDependencies: { typescript: '6.0.3' },
      pnpm: { overrides: dependencies },
    }),
  );
  writeFileSync(
    join(scratch, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        lib: ['ES2022', 'DOM'],
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
      },
      include: ['consumer.ts', 'lace-contract/**/*.ts'],
    }),
  );
  execFileSync('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], {
    cwd: scratch,
    stdio: 'inherit',
  });
  execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], { cwd: scratch, stdio: 'inherit' });
  console.log(`Lace PR #2845 ${laceHead}: packed SDK ${manifest.version} types passed`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
