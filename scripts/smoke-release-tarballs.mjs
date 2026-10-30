#!/usr/bin/env node
// Exercise the exact tarballs that the release workflow will publish.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { packedHostJobsSmoke } from './packed-host-jobs-smoke.mjs';
import { validateInstalledCases } from './consumer/installed-cases.mjs';
import { checkConsumerTarballs } from './consumer-inputs.mjs';

const root = resolve(import.meta.dirname, '..');
const tarballs = resolve(process.env.RELEASE_TARBALL_DIR ?? join(root, 'release-tarballs'));
const manifest = checkConsumerTarballs(tarballs, process.env.RELEASE_VERSION ?? '');
const { dependencies } = manifest;
const scratch = mkdtempSync(join(tmpdir(), 'mn-passport-release-consumer-'));
try {
  writeFileSync(
    join(scratch, 'package.json'),
    JSON.stringify(
      {
        name: 'mn-passport-release-consumer',
        private: true,
        type: 'module',
        dependencies,
        devDependencies: { vite: '8.3.1', typescript: '6.0.3' },
        pnpm: { overrides: dependencies },
      },
      null,
      2,
    ),
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
  const installed = readdirSync(join(scratch, 'node_modules/.pnpm'));
  const compactVersions = new Set(
    installed
      .filter((name) => name.startsWith('@midnight-ntwrk+compact-runtime@'))
      .map((name) => name.split('@').at(-1)?.split('_')[0]),
  );
  if (
    compactVersions.size !== 2 ||
    !compactVersions.has('0.20.0') ||
    !compactVersions.has('0.16.0')
  )
    throw new Error('the scratch consumer has an unexpected Compact runtime inventory');
  const compactJsFolder = installed.find((name) =>
    name.startsWith('@midnight-ntwrk+compact-js@3.0.0-rc.3'),
  );
  if (!compactJsFolder) throw new Error('the pinned compact-js package is absent');
  const compactJs = JSON.parse(
    readFileSync(
      join(
        scratch,
        'node_modules/.pnpm',
        compactJsFolder,
        'node_modules/@midnight-ntwrk/compact-js/package.json',
      ),
      'utf8',
    ),
  );
  if (
    compactJs.dependencies?.['@midnight-ntwrk/compact-runtime'] !== '0.20.0' ||
    compactJs.dependencies?.['compact-runtime-ledger8'] !==
      'npm:@midnight-ntwrk/compact-runtime@0.16.0'
  )
    throw new Error('the two Compact runtimes are not the pinned Ledger 9 and Ledger 8 paths');
  console.log('Compact runtime inventory: 0.20.0 plus the intentional Ledger 8 alias 0.16.0');
  execFileSync(
    'node',
    [
      '--input-type=module',
      '-e',
      `import * as contract from '@input-output-hk/mn-passport-contract';
       import * as binding from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
       import * as account from '@input-output-hk/mn-passport-account';
       import * as browser from '@input-output-hk/mn-passport-adapter-browser';
       import * as hosted from '@input-output-hk/mn-passport-adapter-browser/hosted-jubjub';
       import * as midnight from '@input-output-hk/mn-passport-adapter-midnight-js';
       import * as service from '@input-output-hk/mn-passport-service';
       import * as jobClient from '@input-output-hk/mn-passport-adapter-service';
       if (contract.BINDING_VERSION !== 'acc-s3r1.1' ||
           contract.SUPPORTED_BINDINGS.length !== 1 ||
           typeof binding.Contract !== 'function' ||
           typeof account.createPassportAccounts !== 'function' ||
           typeof account.readVerifiedHoldings !== 'function' ||
           typeof account.addJubjubAuthorisingDevice !== 'function' ||
           typeof account.prepareJubjubGrant !== 'function' ||
           typeof account.issueJubjubGrantCall !== 'function' ||
           typeof account.publishJubjubGrantBookkeeping !== 'function' ||
           typeof account.revokeJubjubGrantCall !== 'function' ||
           typeof account.sealActiveReadGrants !== 'function' ||
           typeof midnight.createMidnightGrantSource !== 'function' ||
           typeof midnight.createMidnightWalletPorts !== 'function' ||
           typeof browser.createBrowserPassport !== 'function' ||
           typeof hosted.hostedJubjubAuthoriser !== 'function' ||
           typeof jobClient.remoteHostJobs !== 'function' ||
           typeof jobClient.remoteHostJobPorts !== 'function' ||
           typeof service.createHostMutationJobs !== 'function' ||
           typeof service.createServer !== 'function' ||
           typeof service.chainRoute !== 'function' ||
           typeof service.zkRoute !== 'function' ||
           typeof service.verifyArtefacts !== 'function')
         throw new Error('packed SDK exports are incomplete');
       const checked = contract.bindAccModule(binding);
       if (Object.keys(checked.pureCircuits).length !== 66)
         throw new Error('grants generated module does not match the package binder');
       const args = contract.buildDeployArgs({
         initialDeviceBoot: new Uint8Array(32),
         encryptionKey: new Uint8Array(32),
         initialRecoveryPk: { x: 0n, y: 0n },
         initialRecoveryWrap: new Uint8Array(64),
         vetoWindowSeconds: 259200n,
       });
       if (args.constructorArgs.length !== 5) throw new Error('old ACC constructor');
       console.log('packed SDK entrypoints loaded');`,
    ],
    { cwd: scratch, stdio: 'inherit' },
  );
  execFileSync(process.execPath, ['--input-type=module', '-e', packedHostJobsSmoke], {
    cwd: scratch,
    stdio: 'inherit',
  });
  // Exercise TTL-zero retained receipts through the exact installed package graph.
  const interrupts = join(scratch, 'installed-interruptions');
  mkdirSync(interrupts);
  const harness = join(scratch, 'installed-host-jobs.mjs');
  copyFileSync(join(root, 'scripts/consumer/installed-host-jobs.mjs'), harness);
  execFileSync(process.execPath, [harness, 'suite', interrupts], {
    cwd: scratch,
    stdio: 'inherit',
    timeout: 60000,
  });
  validateInstalledCases(JSON.parse(readFileSync(join(interrupts, 'cases.json'), 'utf8')));
  console.log('installed package restarts: eight TTL-zero cases and synthetic consent passed');
  mkdirSync(join(scratch, 'src'));
  copyFileSync(join(root, 'tests/fixtures/lace-seams.mjs'), join(scratch, 'src/lace-seams.mjs'));
  writeFileSync(
    join(scratch, 'src/lace-consumer.mjs'),
    `// Lace PR #2845 at 502b0794cc7bcfc76342230193fef4ebb63cae1c.
     // Check the installed tarball types, not workspace paths.
     import { laceAuthoriser, laceFeeSponsor, laceViewingKey } from './lace-seams.mjs';
     /** @type {import('@input-output-hk/mn-passport-account/ports').FeeSponsor} */
     const sponsor = laceFeeSponsor();
     /** @type {import('@input-output-hk/mn-passport-account/ports').AccountViewingKey} */
     const viewing = laceViewingKey();
     /** @type {import('@input-output-hk/mn-passport-account/ports').Authoriser} */
     const directAuthoriser = laceAuthoriser();
     // Structural assignment does not validate Lace's consent kinds; the hosted adapter does.
     /** @param {import('@input-output-hk/mn-passport-protocol').PassportAccount} account */
     const read = (account) => account.readShieldedHoldings?.();
     void [sponsor, viewing, directAuthoriser, read];\n`,
  );
  execFileSync(
    'pnpm',
    [
      'exec',
      'tsc',
      '--noEmit',
      '--allowJs',
      '--checkJs',
      '--strict',
      '--skipLibCheck',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      'src/lace-consumer.mjs',
    ],
    { cwd: scratch, stdio: 'inherit' },
  );
  console.log('Lace-shaped host types checked against packed SDK');
  writeFileSync(
    join(scratch, 'index.html'),
    '<!doctype html><html><body><main id="app"></main><script type="module" src="/src/main.js"></script></body></html>\n',
  );
  writeFileSync(
    join(scratch, 'src/main.js'),
    `import { remoteHostJobs } from '@input-output-hk/mn-passport-adapter-service';
     import { BINDING_VERSION } from '@input-output-hk/mn-passport-contract';
     import { Contract } from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
     import { createPassportAccounts } from '@input-output-hk/mn-passport-account';
     import { createBrowserPassport } from '@input-output-hk/mn-passport-adapter-browser';
     import { hostedJubjubAuthoriser } from '@input-output-hk/mn-passport-adapter-browser/hosted-jubjub';
     document.querySelector('#app').textContent =
       [BINDING_VERSION, Contract.name, createPassportAccounts.name, createBrowserPassport.name, hostedJubjubAuthoriser.name, remoteHostJobs.name].join(' ');\n`,
  );
  execFileSync('pnpm', ['exec', 'vite', 'build'], { cwd: scratch, stdio: 'inherit' });
  if (!existsSync(join(scratch, 'dist/index.html'))) throw new Error('scratch Vite build missing');
  console.log('scratch Vite app built from packed SDK');
  execFileSync(
    'node',
    [
      join(scratch, 'node_modules/@input-output-hk/mn-passport-contract/bin/restore-acc-keys.mjs'),
      '--binding',
      'acc-s3r1.1',
      '--output',
      join(scratch, 'keys'),
      '--circuit',
      'deposit_unshielded',
    ],
    { cwd: scratch, stdio: 'inherit' },
  );
  console.log(`release consumer smoke passed for ${manifest.files.length} tarballs`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
