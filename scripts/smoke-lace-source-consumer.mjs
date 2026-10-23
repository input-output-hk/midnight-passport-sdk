#!/usr/bin/env node
// Compile the actual Lace PR contract seam sources against packed SDK tarballs.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { checkConsumerSource, checkConsumerTarballs, consumerSha256 } from './consumer-inputs.mjs';

const laceHead = process.env.LACE_SOURCE_REVISION ?? '502b0794cc7bcfc76342230193fef4ebb63cae1c';
const laceCheckout = process.env.LACE_CHECKOUT;
if (!laceCheckout) throw new Error('set LACE_CHECKOUT to an authorised consumer checkout');
const sourceScope = [
  'packages/contract/passport/src',
  'packages/module/passport-account/src',
  'packages/module/passport-account/package.json',
  'packages/lib/passkey/src',
];
const sourceIdentity = checkConsumerSource(laceCheckout, laceHead, sourceScope);
const source = join(laceCheckout, 'packages/contract/passport/src');
const laceDependencies = JSON.parse(
  readFileSync(join(laceCheckout, 'packages/module/passport-account/package.json'), 'utf8'),
).dependencies;
/** @type {Record<string, string>} */
const matchedRuntimeVersions = {};
for (const sdkPackage of ['adapter-browser', 'adapter-midnight-js', 'contract']) {
  const sdkManifest = JSON.parse(
    readFileSync(join(import.meta.dirname, '..', 'packages', sdkPackage, 'package.json'), 'utf8'),
  );
  const sdkDependencies = { ...sdkManifest.dependencies, ...sdkManifest.peerDependencies };
  for (const [name, version] of Object.entries(sdkDependencies)) {
    if (!name.startsWith('@midnight') || laceDependencies[name] === undefined) continue;
    if (laceDependencies[name] !== version)
      throw new Error(`Lace ${name}@${laceDependencies[name]} differs from SDK ${version}`);
    matchedRuntimeVersions[name] = version;
  }
}
if (
  !matchedRuntimeVersions['@midnight-ntwrk/compact-runtime'] ||
  !matchedRuntimeVersions['@midnightntwrk/ledger-v9']
)
  throw new Error('Lace and SDK runtime comparison is incomplete');
const root = resolve(import.meta.dirname, '..');
const bindingPin = JSON.parse(
  readFileSync(join(root, 'packages/contract/acc-binding-v2.generated.json'), 'utf8'),
);
const generatedFiles = /** @type {Array<[string, string]>} */ ([
  ['js', 'index.js'],
  ['types', 'index.d.ts'],
]);
const generatedIdentity = Object.fromEntries(
  generatedFiles.map(([kind, name]) => {
    const digest = consumerSha256(
      readFileSync(join(laceCheckout, 'packages/module/passport-account/src/acc/generated', name)),
    );
    if (digest !== bindingPin.module[kind].sha256)
      throw new Error('consumer generated ACC differs from the supported binding');
    return [kind, digest];
  }),
);
const tarballs = resolve(process.env.RELEASE_TARBALL_DIR ?? join(root, 'release-tarballs'));
const manifest = checkConsumerTarballs(tarballs, process.env.RELEASE_VERSION ?? '');
const { dependencies } = manifest;
const scratch = mkdtempSync(join(tmpdir(), 'mn-passport-lace-source-'));
try {
  const laceSource = join(scratch, 'lace-contract');
  mkdirSync(laceSource);
  for (const name of ['types.ts', 'grants.ts', 'errors.ts'])
    cpSync(join(source, name), join(laceSource, name), { recursive: true, force: true });
  cpSync(join(source, 'value-objects'), join(laceSource, 'value-objects'), { recursive: true });
  mkdirSync(join(laceSource, 'store'));
  cpSync(join(source, 'store/slice.ts'), join(laceSource, 'store/slice.ts'));
  cpSync(join(root, 'tests/fixtures/lace-source-consumer.ts'), join(scratch, 'consumer.ts'));
  cpSync(
    join(laceCheckout, 'packages/module/passport-account/src/acc/generated/index.d.ts'),
    join(scratch, 'lace-acc-generated.d.ts'),
  );
  const handleSource = readFileSync(
    join(laceCheckout, 'packages/module/passport-account/src/acc/gated-call.ts'),
    'utf8',
  );
  const handleFile = ts.createSourceFile(
    'gated-call.ts',
    handleSource,
    ts.ScriptTarget.Latest,
    true,
  );
  const handleAlias = handleFile.statements.find(
    (statement) =>
      ts.isTypeAliasDeclaration(statement) && statement.name.text === 'GatedContractHandle',
  );
  if (!handleAlias) throw new Error('Lace GatedContractHandle declaration is missing');
  writeFileSync(join(scratch, 'lace-gated-handle.ts'), `${handleAlias.getText(handleFile)}\n`);
  writeFileSync(
    join(scratch, 'package.json'),
    JSON.stringify({
      name: 'mn-passport-lace-source-consumer',
      private: true,
      type: 'module',
      dependencies: {
        ...dependencies,
        '@reduxjs/toolkit': '2.11.2',
        immer: '10.2.0',
        'ts-custom-error': '3.3.1',
        'type-fest': '4.41.0',
        '@midnight-ntwrk/compact-runtime': '0.20.0',
      },
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
      include: [
        'consumer.ts',
        'lace-contract/**/*.ts',
        'lace-gated-handle.ts',
        'lace-acc-generated.d.ts',
      ],
    }),
  );
  execFileSync('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile'], {
    cwd: scratch,
    stdio: 'inherit',
  });
  execFileSync(
    'node',
    [
      join(root, 'scripts/check-midnight-runtime-identity.mjs'),
      scratch,
      ...manifest.files.map(({ name }) => name),
    ],
    { stdio: 'inherit' },
  );
  execFileSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.json'], { cwd: scratch, stdio: 'inherit' });
  checkConsumerSource(laceCheckout, laceHead, sourceScope);
  if (process.env.CONSUMER_RECEIPT_FILE) {
    writeFileSync(
      process.env.CONSUMER_RECEIPT_FILE,
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'source-types',
          source: sourceIdentity,
          sdkVersion: manifest.version,
          manifestSha256: manifest.manifestSha256,
          matchedRuntimeVersions,
          bindingId: bindingPin.id,
          bindingManifestSha256: bindingPin.manifestSha256,
          generatedIdentity,
          checks: ['tarball-sha256', 'physical-runtime-identity', 'source-types'],
          fullCompatibility: false,
          realProvider: false,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }
  console.log(
    `Lace PR #2845 ${laceHead}: packed SDK ${manifest.version} types passed; ` +
      `${Object.keys(matchedRuntimeVersions).length} direct Midnight runtime versions match`,
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
