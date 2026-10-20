#!/usr/bin/env node
// Run negative protocol checks in an installed, unmodified checkout of the pinned Lace head.
import { execFileSync } from 'node:child_process';
import { constants, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { checkConsumerSource } from './consumer-inputs.mjs';

const expected = process.env.LACE_SOURCE_REVISION ?? '502b0794cc7bcfc76342230193fef4ebb63cae1c';
const checkout = process.env.LACE_CHECKOUT;
if (!checkout) throw new Error('set LACE_CHECKOUT to an installed Lace checkout');
const cwd = resolve(checkout);
checkConsumerSource(cwd, expected, [
  'packages/module/passport-account/src',
  'packages/lib/passkey/src',
]);
const target = join(
  cwd,
  'packages/module/passport-account/test/remote/signer-consent.diagnostic.test.ts',
);
if (existsSync(target)) throw new Error(`refusing to overwrite ${target}`);
let copied = false;
try {
  copyFileSync(
    join(import.meta.dirname, '../experiments/lace-consumer/signer-consent.diagnostic.test.ts'),
    target,
    constants.COPYFILE_EXCL,
  );
  copied = true;
  const nx = join(cwd, 'node_modules/nx/bin/nx.js');
  if (!existsSync(nx)) throw new Error('install the pinned Lace workspace dependencies first');
  execFileSync(
    process.execPath,
    [
      nx,
      'test',
      '@lace-module/passport-account',
      '--skip-nx-cache',
      '--',
      'test/remote/signer-consent.diagnostic.test.ts',
    ],
    { cwd, stdio: 'inherit' },
  );
  console.log(
    `Lace ${expected}: consent limitations and empty-batch behavior reproduced; this is not a positive interoperability test`,
  );
} finally {
  if (copied) rmSync(target, { force: true });
}
