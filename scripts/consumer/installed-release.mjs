#!/usr/bin/env node
// Compose existing prepared-consumer checks; never installs or approves a dependency graph.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertQualityUnchanged,
  captureInstalledQuality,
  installedQualityContext,
  qualityFile,
} from './installed-quality-inputs.mjs';
import { installedQualityOutput, runInstalledQuality } from './installed-quality.mjs';
import { runInstalledCrypto } from './installed-crypto.mjs';

/** @param {import('./installed-crypto.mjs').CryptoOptions} options */
export async function runInstalledRelease(options) {
  const context = installedQualityContext({
    ...options,
    repository: options.repository ?? resolve(import.meta.dirname, '../..'),
  });
  // Admit every destination before any check starts; failed roots are retained.
  const output = installedQualityOutput(context.consumer, options.output),
    qualityOutput = installedQualityOutput(context.consumer, output + '-quality'),
    cryptoOutput = installedQualityOutput(context.consumer, output + '-crypto');
  mkdirSync(output, { mode: 0o700 });
  const runner = qualityFile(fileURLToPath(import.meta.url));
  const startedAt = new Date().toISOString();
  /** @type {unknown} */ let before, failure;
  /** @type {Record<string,unknown>} */ const checks = {};
  let phase = 'inputs',
    inputsUnchanged = false;
  try {
    before = captureInstalledQuality(context);
    phase = 'quality';
    runInstalledQuality({ ...options, output: qualityOutput });
    checks.quality = qualityFile(join(qualityOutput, 'receipt.json'));
    phase = 'crypto';
    await runInstalledCrypto({ ...options, output: cryptoOutput });
    checks.crypto = qualityFile(join(cryptoOutput, 'receipt.json'));
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (!before) throw Error('Release consumer initial inputs were not admitted');
      assertQualityUnchanged(before, captureInstalledQuality(context));
      assertQualityUnchanged(runner, qualityFile(runner.path));
      inputsUnchanged = true;
    } catch (error) {
      if (failure === undefined) failure = error;
    }
    writeFileSync(
      join(output, 'receipt.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'prepared-installed-release-checks',
          outcome: failure === undefined ? 'passed' : 'failed',
          startedAt,
          endedAt: new Date().toISOString(),
          version: context.version,
          manifestSha256: context.manifestSha256,
          lockSha256: context.lockSha256,
          checks,
          runner,
          inputsUnchanged,
          failure:
            failure === undefined
              ? null
              : {
                  phase,
                  message: failure instanceof Error ? failure.message : String(failure),
                },
          claims: {
            installs: false,
            registryProvenance: false,
            releasedPackage: false,
            nativeProof: false,
            realProvider: false,
          },
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }
  if (failure !== undefined) throw failure;
  return { output, outcome: 'passed', kind: 'prepared-installed-release-checks' };
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
      await runInstalledRelease({ consumer, version, manifestSha256, lockSha256, output }),
    ),
  );
}
