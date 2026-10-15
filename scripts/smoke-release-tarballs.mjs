#!/usr/bin/env node
// Exercise the exact tarballs that the release workflow will publish.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const tarballs = join(root, 'release-tarballs');
/** @type {{version: string, files: Array<{name: string, file: string}>}} */
const manifest = JSON.parse(readFileSync(join(tarballs, 'manifest.json'), 'utf8'));
if (manifest.version !== process.env.RELEASE_VERSION || manifest.files?.length !== 9)
  throw new Error('release pack manifest is missing or has an unexpected version');
const dependencies = Object.fromEntries(
  manifest.files.map(({ name, file }) => {
    const path = join(tarballs, file);
    if (!existsSync(path)) throw new Error(`missing release tarball ${file}`);
    return [name, `file:${path}`];
  }),
);
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
      '--input-type=module',
      '-e',
      `import * as contract from '@input-output-hk/mn-passport-contract';
       import * as binding from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
       import * as account from '@input-output-hk/mn-passport-account';
       import * as browser from '@input-output-hk/mn-passport-adapter-browser';
       import * as hosted from '@input-output-hk/mn-passport-adapter-browser/hosted-jubjub';
       import * as midnight from '@input-output-hk/mn-passport-adapter-midnight-js';
       import * as service from '@input-output-hk/mn-passport-service';
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
           typeof browser.createBrowserPassport !== 'function' ||
           typeof hosted.hostedJubjubAuthoriser !== 'function' ||
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
  mkdirSync(join(scratch, 'src'));
  copyFileSync(join(root, 'tests/fixtures/lace-seams.mjs'), join(scratch, 'src/lace-seams.mjs'));
  writeFileSync(
    join(scratch, 'src/lace-consumer.mjs'),
    `// Lace PR #2845 at cdfa9cfd81a0adcc0a7224aa624f18e52494f602.
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
    `import { BINDING_VERSION } from '@input-output-hk/mn-passport-contract';
     import { Contract } from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
     import { createPassportAccounts } from '@input-output-hk/mn-passport-account';
     import { createBrowserPassport } from '@input-output-hk/mn-passport-adapter-browser';
     import { hostedJubjubAuthoriser } from '@input-output-hk/mn-passport-adapter-browser/hosted-jubjub';
     document.querySelector('#app').textContent =
       [BINDING_VERSION, Contract.name, createPassportAccounts.name, createBrowserPassport.name, hostedJubjubAuthoriser.name].join(' ');\n`,
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
