#!/usr/bin/env node
// Opt-in prepared-consumer software crypto. Never installs, builds or approves dependency graphs.
import { constants, copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  installedQualityContext,
  qualityFile,
  assertQualityUnchanged,
} from './installed-quality-inputs.mjs';
import {
  captureCryptoInputs,
  cryptoLoader,
  cryptoOutput,
  readCryptoResult,
  verifyCryptoResolutions,
} from './installed-crypto-inputs.mjs';
import { runCryptoChild } from './installed-crypto-process.mjs';
import { installedCryptoGuard } from './crypto/node-guard.mjs';
import { validateCryptoResult, cryptoClaims } from './crypto/contracts.mjs';

/** @typedef {import('./installed-quality-inputs.mjs').InstalledQualityContext} Context */
/** @typedef {{consumer:string,output:string,repository?:string,version:string,manifestSha256:string,lockSha256:string}} CryptoOptions */

/** @param {Context} context @param {string} directory */
function prepareCryptoChild(context, directory) {
  for (const name of ['entry', 'modules', 'generated-account', 'contracts'])
    copyFileSync(
      fileURLToPath(new URL(`crypto/${name}.mjs`, import.meta.url)),
      join(directory, `${name}.mjs`),
      constants.COPYFILE_EXCL,
    );
  const guard = installedCryptoGuard(context);
  writeFileSync(join(directory, 'guard.mjs'), guard.code, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'loader.mjs'), cryptoLoader(context, directory), {
    flag: 'wx',
    mode: 0o600,
  });
  writeFileSync(
    join(directory, 'pins.json'),
    JSON.stringify({
      consumer: context.consumer,
      version: context.version,
      manifestSha256: context.manifestSha256,
      lockSha256: context.lockSha256,
    }) + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  return {
    probes: guard.probes,
    generated: [
      'entry.mjs',
      'modules.mjs',
      'generated-account.mjs',
      'contracts.mjs',
      'guard.mjs',
      'loader.mjs',
      'pins.json',
    ].map((file) => qualityFile(join(directory, file))),
  };
}

/** @param {string} directory */
async function executeCryptoChild(directory) {
  const child = await runCryptoChild(
    [
      '--import',
      join(directory, 'guard.mjs'),
      '--experimental-loader',
      join(directory, 'loader.mjs'),
      join(directory, 'entry.mjs'),
    ],
    { cwd: directory },
  );
  writeFileSync(join(directory, 'stdout.log'), child.stdout, { flag: 'wx', mode: 0o600 });
  writeFileSync(join(directory, 'stderr.log'), child.stderr, { flag: 'wx', mode: 0o600 });
  return {
    outcome: child.outcome,
    exitCode: child.exitCode,
    signal: child.signal,
    elapsedMs: child.elapsedMs,
    outputBytes: child.outputBytes,
    spawnError: child.spawnError,
    stdout: qualityFile(join(directory, 'stdout.log')),
    stderr: qualityFile(join(directory, 'stderr.log')),
  };
}

/** Prepared archive/lock pins are mandatory. Graph admission and build/registry provenance are separate.
 * @param {CryptoOptions} options */
export async function runInstalledCrypto(options) {
  const context = installedQualityContext({
    ...options,
    repository: options.repository ?? resolve(import.meta.dirname, '../..'),
  });
  const directory = cryptoOutput(context.consumer, options.output);
  mkdirSync(directory, { mode: 0o700 });
  /** @type {ReturnType<typeof captureCryptoInputs>|undefined} */ let before, after;
  /** @type {ReturnType<typeof prepareCryptoChild>|undefined} */ let prepared;
  /** @type {Awaited<ReturnType<typeof executeCryptoChild>>|undefined} */ let child;
  /** @type {unknown} */ let result, failure, integrityFailure;
  let phase = 'inputs',
    inputsUnchanged = false;
  const startedAt = new Date().toISOString();
  try {
    before = captureCryptoInputs(context);
    phase = 'setup';
    prepared = prepareCryptoChild(context, directory);
    phase = 'child';
    child = await executeCryptoChild(directory);
    if (child.outcome !== 'passed')
      throw Error('Installed crypto child failed; inspect retained logs');
    phase = 'result';
    const checked = validateCryptoResult(readCryptoResult(join(directory, 'crypto-results.json')));
    verifyCryptoResolutions(context, checked.resolutions);
    result = checked;
  } catch (error) {
    failure = error;
  } finally {
    try {
      after = captureCryptoInputs(context);
      if (!before) throw Error('Installed crypto initial inputs were not admitted');
      assertQualityUnchanged(before, after);
      if (prepared) {
        assertQualityUnchanged(
          prepared.generated,
          prepared.generated.map(({ path }) => qualityFile(path)),
        );
        for (const probe of prepared.probes)
          assertQualityUnchanged(probe.file, qualityFile(probe.file.path));
      }
      inputsUnchanged = true;
    } catch (error) {
      integrityFailure = error;
    }
    const errorText = (/** @type {unknown} */ error) =>
      error instanceof Error ? error.message : String(error);
    writeFileSync(
      join(directory, 'receipt.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'installed-candidate-software-crypto',
          outcome: failure === undefined && integrityFailure === undefined ? 'passed' : 'failed',
          startedAt,
          endedAt: new Date().toISOString(),
          version: context.version,
          manifestSha256: context.manifestSha256,
          lockSha256: context.lockSha256,
          nodeVersion: process.version,
          scope:
            'Recorded installed graph and software generated-contract checks; dependency admission/build provenance are separate.',
          claims: { ...cryptoClaims, installs: false, builds: false, registryProvenance: false },
          before,
          after,
          prepared,
          child,
          result,
          inputsUnchanged,
          failure: failure === undefined ? null : { phase, message: errorText(failure) },
          integrityFailure: integrityFailure === undefined ? null : errorText(integrityFailure),
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }
  if (failure !== undefined) throw failure;
  if (integrityFailure !== undefined) throw integrityFailure;
  return { directory, outcome: 'passed', kind: 'installed-candidate-software-crypto' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , flag, output] = process.argv;
  const {
    CONSUMER_ROOT: consumer,
    RELEASE_VERSION: version,
    CONSUMER_MANIFEST_SHA256: manifestSha256,
    CONSUMER_LOCK_SHA256: lockSha256,
  } = process.env;
  if (
    process.argv.length !== 4 ||
    flag !== '--output' ||
    !output ||
    !consumer ||
    !version ||
    !manifestSha256 ||
    !lockSha256
  )
    throw Error(
      'Use CONSUMER_ROOT/RELEASE_VERSION/CONSUMER_MANIFEST_SHA256/CONSUMER_LOCK_SHA256 and --output NEW_CONSUMER_CHILD',
    );
  console.log(
    JSON.stringify(
      await runInstalledCrypto({ consumer, version, manifestSha256, lockSha256, output }),
    ),
  );
}
