#!/usr/bin/env node
// Audited installed packages only. Packing, installation and release are separate operations.
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  assertQualityUnchanged,
  captureInstalledQuality,
  installedQualityContext,
} from './installed-quality-inputs.mjs';
import { compileInstalledQuality, verifyCompilerInputs } from './installed-quality-types.mjs';
import { importInstalledExports } from './installed-quality-runtime.mjs';

/** @param {string} consumer @param {string} output */
export function installedQualityOutput(consumer, output) {
  if (!isAbsolute(output)) throw Error('installed quality output must be absolute');
  if (lstatSync(output, { throwIfNoEntry: false }))
    throw Error('installed quality output already exists; retain it and choose a fresh path');
  const root = realpathSync(consumer),
    parent = realpathSync(dirname(resolve(output)));
  if (parent !== root)
    throw Error('installed quality output must be a fresh direct child of consumer');
  return join(parent, basename(resolve(output)));
}

/** Receipts distinguish real installed-byte/type/import evidence from release/native claims.
 * @param {{consumer:string,output:string,repository?:string,version:string,manifestSha256:string,lockSha256:string}} options
 */
export function runInstalledQuality(options) {
  const context = installedQualityContext({
    ...options,
    repository: options.repository ?? resolve(import.meta.dirname, '../..'),
  });
  const output = installedQualityOutput(context.consumer, options.output);
  mkdirSync(output, { mode: 0o700 });
  /** @type {Record<string,unknown>} */ const evidence = {};
  /** @type {ReturnType<typeof compileInstalledQuality>|undefined} */ let compile;
  /** @type {unknown} */ let failure;
  const startedAt = new Date().toISOString();
  try {
    evidence.before = captureInstalledQuality(context);
    compile = compileInstalledQuality(context, output);
    evidence.compile = compile;
    evidence.runtime = importInstalledExports(context, join(output, 'runtime'));
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (compile)
        for (const lane of [...compile.quality, ...compile.docs]) verifyCompilerInputs(lane.inputs);
      evidence.after = captureInstalledQuality(context);
      assertQualityUnchanged(evidence.before, evidence.after);
      evidence.inputsUnchanged = true;
    } catch (error) {
      evidence.integrityFailure = error instanceof Error ? error.message : String(error);
      if (failure === undefined) failure = error;
    }
    if (failure !== undefined)
      evidence.failure = failure instanceof Error ? failure.message : String(failure);
    writeFileSync(
      join(output, 'receipt.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          kind: 'installed-local-candidate-quality',
          outcome: failure === undefined ? 'passed' : 'failed',
          startedAt,
          endedAt: new Date().toISOString(),
          version: context.version,
          manifestSha256: context.manifestSha256,
          lockSha256: context.lockSha256,
          nodeVersion: process.version,
          typescriptVersion: ts.version,
          claims: {
            installedPackageBytes: true,
            runnerInstallsPackages: false,
            registryProvenance: false,
            releasedPackage: false,
            nativeProof: false,
            realProvider: false,
            fullLace: false,
          },
          ...evidence,
        },
        null,
        2,
      ) + '\n',
      { flag: 'wx', mode: 0o600 },
    );
  }
  if (failure !== undefined) throw failure;
  return { output, outcome: 'passed', kind: 'installed-local-candidate-quality' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , flag, output] = process.argv;
  if (
    process.argv.length !== 4 ||
    flag !== '--output' ||
    !output ||
    !process.env.CONSUMER_ROOT ||
    !process.env.RELEASE_VERSION ||
    !process.env.CONSUMER_MANIFEST_SHA256 ||
    !process.env.CONSUMER_LOCK_SHA256
  )
    throw Error(
      'usage: CONSUMER_ROOT=... RELEASE_VERSION=... CONSUMER_MANIFEST_SHA256=... CONSUMER_LOCK_SHA256=... node installed-quality.mjs --output NEW_CONSUMER_CHILD',
    );
  console.log(
    JSON.stringify(
      runInstalledQuality({
        consumer: process.env.CONSUMER_ROOT,
        output,
        version: process.env.RELEASE_VERSION,
        manifestSha256: process.env.CONSUMER_MANIFEST_SHA256,
        lockSha256: process.env.CONSUMER_LOCK_SHA256,
      }),
    ),
  );
}
