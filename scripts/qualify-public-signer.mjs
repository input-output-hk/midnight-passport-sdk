#!/usr/bin/env node
// Opt-in real public handler transport; deliberately no Docker, wallet or native proof.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { buildPublicSigner, verifyPublicSigner } from './consumer/public-signer-source.mjs';
import { consumerSha256 } from './consumer-inputs.mjs';
import { workspaceIdentity } from './qualification/receipt.mjs';
const repository = resolve(import.meta.dirname, '..');
export async function runPublicSigner(env = process.env) {
  assert.ok(env.IN_NIX_SHELL, 'Use Nix');
  const root = env.PASSPORT_SIGNER_ROOT ?? '',
    expected = env.PASSPORT_SIGNER_SHA256 ?? '';
  assert.ok(isAbsolute(root));
  const input = verifyPublicSigner(root, expected, repository);
  const output = env.PASSPORT_SIGNER_PROTOCOL_ROOT ?? '';
  assert.ok(isAbsolute(output));
  assert.equal(realpathSync(dirname(output)), realpathSync(input.consumer.root));
  assert.match(basename(output), /^signer-protocol-[a-z0-9-]+$/);
  assert.equal(existsSync(output), false, 'Preserve failed and successful protocol roots');
  const source = await workspaceIdentity(repository);
  mkdirSync(output, { mode: 0o700 });
  /** @type {Array<[string,string]>} */
  const files = [
    ['tests/fixtures/public-signer-protocol.js', 'protocol.mjs'],
    ['tests/fixtures/public-signer-harness.js', 'public-signer-harness.js'],
    ['scripts/qualification/signer-windows.mjs', 'signer-windows.mjs'],
    ['scripts/qualification/secret-scan.mjs', 'secret-scan.mjs'],
  ];
  /** @type {Record<string,string>} */
  const harness = {};
  for (const [from, to] of files) {
    copyFileSync(join(repository, from), join(output, to));
    harness[from] = consumerSha256(readFileSync(join(output, to)));
  }
  let outcome = 'failed',
    failureSha256;
  try {
    const log = execFileSync(
      process.execPath,
      [join(output, 'protocol.mjs'), output, join(root, 'bundle/handlers.mjs')],
      {
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
        encoding: 'utf8',
        env: { ...env, NODE_OPTIONS: '' },
      },
    );
    writeFileSync(join(output, 'worker.private.log'), log, { flag: 'wx', mode: 0o600 });
    verifyPublicSigner(root, expected, repository);
    for (const [from, to] of files)
      assert.equal(consumerSha256(readFileSync(join(output, to))), harness[from]);
    assert.deepEqual(await workspaceIdentity(repository), source);
    const result = JSON.parse(readFileSync(join(output, 'protocol-result.json'), 'utf8'));
    assert.equal(result.kind, 'public-signer-protocol');
    assert.equal(result.testsPassed, 12);
    assert.equal(new Set(result.cases).size, 12);
    assert.equal(result.chainCalls, 1);
    for (const field of [
      'realHandlers',
      'nativeMessageChannel',
      'simulatedWindowRouting',
      'syntheticCredentials',
      'fakeChain',
    ])
      assert.equal(result[field], true);
    for (const field of ['nativeProof', 'signerPage', 'realProvider', 'fullCompatibility'])
      assert.equal(result[field], false);
    assert.deepEqual(result.listenerCounts, { dapp: 0, signer: 0 });
    outcome = 'passed';
  } catch (error) {
    failureSha256 = consumerSha256(String(error));
    writeFileSync(join(output, 'failure.private.log'), String(error) + '\n', {
      flag: 'wx',
      mode: 0o600,
    });
    const detail = /** @type {any} */ (error);
    if (detail?.stderr)
      writeFileSync(join(output, 'stderr.private.log'), detail.stderr, { flag: 'wx', mode: 0o600 });
  }
  const receipt = {
    schemaVersion: 1,
    kind: 'verified-public-signer-protocol',
    outcome,
    source,
    signerConfigSha256: expected,
    publicSource: input.source.commit,
    consumerConfigSha256: input.consumer.configSha256,
    harness,
    resultSha256: existsSync(join(output, 'protocol-result.json'))
      ? consumerSha256(readFileSync(join(output, 'protocol-result.json')))
      : null,
    failureSha256,
    nativeProof: false,
    realProvider: false,
    releaseQualified: false,
  };
  writeFileSync(
    join(output, 'protocol-parent-receipt.json'),
    JSON.stringify(receipt, null, 2) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  console.log(JSON.stringify(receipt, null, 2));
  assert.equal(outcome, 'passed', 'Preserve the failed root and inspect its private logs');
  return receipt;
}
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const mode = process.argv[2];
  if (mode === 'prepare')
    console.log(
      JSON.stringify(
        await buildPublicSigner({
          consumer: process.env.CONSUMER_ROOT ?? '',
          consumerPin: process.env.CONSUMER_CONFIG_SHA256 ?? '',
          source: process.env.PASSPORT_PUBLIC_SOURCE_ROOT ?? '',
          extras: process.env.PASSPORT_SIGNER_DEPS ?? '',
          output: process.env.PASSPORT_SIGNER_ROOT ?? '',
          repository,
        }),
        null,
        2,
      ),
    );
  else {
    assert.equal(mode, 'run', 'Use prepare or run');
    await runPublicSigner();
  }
}
