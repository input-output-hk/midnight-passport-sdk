// Synthetic npm archives/installed trees only: no package-manager install or external dependency.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { releasePackageDirectories } from '../../scripts/release-package-list.mjs';
import { auditInstalledBundle } from '../../scripts/consumer/installed-inputs.mjs';
import {
  installedQualityContext,
  qualityHash,
} from '../../scripts/consumer/installed-quality-inputs.mjs';

export function installedFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'passport-installed-quality-')));
  const consumer = join(root, 'consumer'),
    repository = join(root, 'repository');
  const bundle = join(consumer, 'bundle'),
    version = '0.0.0-dev.synthetic';
  mkdirSync(bundle, { recursive: true });
  mkdirSync(join(repository, 'docs/site'), { recursive: true });
  mkdirSync(join(repository, 'docs/examples'), { recursive: true });
  writeFileSync(join(repository, 'docs/site/index.md'), '# Synthetic docs\n');
  writeFileSync(
    join(repository, 'docs/examples/checked-snippets.json'),
    JSON.stringify({ version: 1, pages: [], files: [] }),
  );
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'synthetic-installed-consumer', type: 'module', private: true }),
  );
  writeFileSync(join(consumer, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  const identities = {
    '@midnight-ntwrk/compact-js': '3.0.0-rc.3',
    '@midnight-ntwrk/compact-runtime': '0.20.0',
    '@midnightntwrk/ledger-v9': '1.0.0-rc.5',
  };
  for (const [name, version] of Object.entries(identities)) {
    const folder = join(consumer, 'node_modules', name);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'package.json'), JSON.stringify({ name, version }));
    writeFileSync(join(folder, 'index.js'), 'export const synthetic=true;\n');
  }
  const files = releasePackageDirectories.map((directory) => {
    const name = '@input-output-hk/mn-passport-' + directory;
    const source = join(repository, 'packages', directory);
    mkdirSync(join(source, 'src'), { recursive: true });
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name, version: '0.0.0' }));
    writeFileSync(join(source, 'src/index.ts'), 'export const source=7;\n');
    const folder = join(consumer, 'node_modules', name);
    mkdirSync(join(folder, 'dist'), { recursive: true });
    const pkg = {
      name,
      version,
      type: 'module',
      dependencies: directory === 'account' ? identities : {},
      exports: {
        '.': { types: './dist/index.d.ts', default: './dist/index.js' },
        './metadata.json': './metadata.json',
      },
    };
    writeFileSync(join(folder, 'package.json'), JSON.stringify(pkg));
    writeFileSync(join(folder, 'dist/index.js'), 'export const value=7;\n');
    writeFileSync(join(folder, 'dist/index.d.ts'), 'export declare const value:number;\n');
    writeFileSync(join(folder, 'metadata.json'), JSON.stringify({ synthetic: true }));
    const archive = join(root, 'archive', directory, 'package');
    mkdirSync(join(archive, 'dist'), { recursive: true });
    for (const path of ['package.json', 'metadata.json', 'dist/index.js', 'dist/index.d.ts'])
      writeFileSync(join(archive, path), readFileSync(join(folder, path)));
    const file = directory + '.tgz';
    execFileSync('tar', ['-czf', join(bundle, file), '-C', join(archive, '..'), 'package']);
    return { name, file, sha256: qualityHash(readFileSync(join(bundle, file))) };
  });
  writeFileSync(join(bundle, 'manifest.json'), JSON.stringify({ version, files }));
  const pins = {
    consumer,
    repository,
    version,
    manifestSha256: qualityHash(readFileSync(join(bundle, 'manifest.json'))),
    lockSha256: qualityHash(readFileSync(join(consumer, 'pnpm-lock.yaml'))),
  };
  writeFileSync(
    join(consumer, 'qualification-inputs.json'),
    JSON.stringify({
      schemaVersion: 1,
      ...pins,
      installed: auditInstalledBundle(consumer, bundle, version),
      packageJsonSha256: qualityHash(readFileSync(join(consumer, 'package.json'))),
      nodeVersion: process.version,
      runtimeIdentity: Object.keys(identities).sort(),
    }),
  );
  const context = installedQualityContext(pins);
  return {
    root,
    consumer,
    repository,
    bundle,
    version,
    files,
    pins,
    context,
    account: join(consumer, 'node_modules/@input-output-hk/mn-passport-account'),
  };
}
