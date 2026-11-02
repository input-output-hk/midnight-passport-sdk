#!/usr/bin/env node
// Read-only trust gate controls. Never import any signer bundle; preserve every mutated copy.
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  writeFileSync,
  appendFileSync,
  unlinkSync,
  symlinkSync,
  realpathSync,
} from 'node:fs';
import { join, resolve, dirname, basename, isAbsolute } from 'node:path';
import { verifyPublicSigner } from './consumer/public-signer-source.mjs';
import { workspaceIdentity } from './qualification/receipt.mjs';
import { consumerSha256 } from './consumer-inputs.mjs';
/** @param {NodeJS.ProcessEnv} [env] */
export async function runSignerIntegrity(env = process.env) {
  assert.ok(env.IN_NIX_SHELL, 'Use pinned Nix');
  const repository = resolve(import.meta.dirname, '..');
  const root = env.PASSPORT_SIGNER_ROOT ?? '',
    pin = env.PASSPORT_SIGNER_SHA256 ?? '';
  const input = verifyPublicSigner(root, pin, repository);
  const source = await workspaceIdentity(repository);
  assert.equal(source.dirty, false, 'Commit integrity controls first');
  const output = env.PASSPORT_SIGNER_INTEGRITY_ROOT ?? '';
  assert.ok(isAbsolute(output));
  assert.equal(realpathSync(dirname(output)), realpathSync(input.consumer.root));
  assert.match(basename(output), /^signer-integrity-[a-z0-9-]+$/);
  assert.equal(existsSync(output), false, 'Preserve every prior control root');
  assert.ok(
    !resolve(output).startsWith(realpathSync(root) + '/'),
    'Control root must not be inside its input',
  );
  mkdirSync(output, { mode: 0o700 });
  /** @type {Array<{name:string,rejected:boolean,failureSha256?:string|undefined}>} */ const cases =
    [];
  const controls = [
    'config',
    'entry',
    'bundle-content',
    'bundle-missing',
    'bundle-extra',
    'bundle-link',
  ];
  let outcome = 'failed',
    failureSha256;
  try {
    for (const name of controls) {
      const copy = join(output, name);
      cpSync(root, copy, { recursive: true, errorOnExist: true, force: false });
      if (name === 'config') appendFileSync(join(copy, 'signer-inputs.json'), '\n');
      else if (name === 'entry')
        appendFileSync(join(copy, 'source-entry.ts'), '\n// controlled mutation\n');
      else {
        const files = readdirSync(join(copy, 'bundle')).filter((f) => f.endsWith('.mjs'));
        assert.ok(files.length > 0);
        const target = join(copy, 'bundle', files[0] ?? '');
        if (name === 'bundle-content') appendFileSync(target, '\n// controlled mutation\n');
        if (name === 'bundle-missing') unlinkSync(target);
        if (name === 'bundle-extra') writeFileSync(join(copy, 'bundle', 'extra.txt'), 'controlled');
        if (name === 'bundle-link') symlinkSync(target, join(copy, 'bundle', 'redirect.mjs'));
      }
      let error;
      try {
        verifyPublicSigner(copy, pin, repository);
      } catch (e) {
        error = e;
      }
      cases.push({
        name,
        rejected: Boolean(error),
        failureSha256: error ? consumerSha256(String(error)) : undefined,
      });
      assert.ok(error, 'Changed signer input was accepted');
    }
    verifyPublicSigner(root, pin, repository);
    assert.deepEqual(await workspaceIdentity(repository), source);
    outcome = 'passed';
  } catch (error) {
    failureSha256 = consumerSha256(String(error));
  }
  const receipt = {
    schemaVersion: 1,
    kind: 'public-signer-integrity-controls',
    source,
    signerConfigSha256: pin,
    consumerConfigSha256: input.consumer.configSha256,
    outcome,
    cases,
    failureSha256,
    importedBundle: false,
    nativeProof: false,
    realProvider: false,
    releaseQualified: false,
  };
  writeFileSync(join(output, 'integrity-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', {
    flag: 'wx',
    mode: 0o600,
  });
  console.log(JSON.stringify(receipt, null, 2));
  assert.equal(outcome, 'passed', 'Preserve failed control roots');
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename)
  await runSignerIntegrity();
