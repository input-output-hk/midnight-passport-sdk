#!/usr/bin/env node
// Opt-in standalone mounted production images. Never publishes or adopts an old stack.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isolationProfile,
  ISOLATED_ENDPOINTS,
  assertIsolationOverrides,
} from '../qualification/native-isolation-profile.mjs';
import { isolatedContainerArguments } from '../qualification/native-isolated-stack.mjs';
import { dedicatedIndexerReadiness } from '../qualification/indexer-readiness.mjs';
import { mountedPlan } from './mounted-plan.mjs';
import { preflightMounted } from './mounted-preflight.mjs';
import { freshRoot, object, put, saveJournal, sha256 } from './files.mjs';
import { localDocker } from './docker.mjs';
import { ResourceOwner, claimReleaseLease } from './resources.mjs';
import { mountedInterval } from './mounted-interval.mjs';
import { mountedCapture } from './mounted-inputs.mjs';
import { mountedServices, waitMounted } from './mounted-services.mjs';
import { mountedClient, repeatedFunding } from './mounted-client.mjs';

const REPOSITORY = realpathSync(resolve(import.meta.dirname, '../..'));
/** @param {ReturnType<typeof mountedPlan>} plan @param {ResourceOwner} owner @param {string} root @param {()=>void} check */
async function startChain(plan, owner, root, check) {
  const profile = isolationProfile(owner.runId, root);
  owner.create('network', profile.project, []);
  for (const role of ['node', 'indexer'])
    owner.create('volume', `${profile.project}-${role}-data`, []);
  const rows = plan.chainImages.map((pin) => {
    const current = JSON.parse(owner.docker(['image', 'inspect', pin.tag]).stdout)[0];
    assert.equal(current.Id, pin.id);
    assert.equal(current.Os, 'linux');
    const args = isolatedContainerArguments(profile, pin.role, pin.id);
    return {
      ...pin,
      resource: owner.create('container', `${profile.project}-${pin.role}`, args.slice(5), pin.id),
    };
  });
  const node = rows.find((row) => row.role === 'node');
  assert.ok(node);
  owner.start(node.resource);
  await waitMounted(
    check,
    async () => {
      try {
        const response = await fetch(ISOLATED_ENDPOINTS.nodeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'chain_getHeader', params: [] }),
          signal: AbortSignal.timeout(2_000),
        });
        const value = object(await response.json()),
          result = object(value.result);
        return (
          response.ok &&
          typeof result.number === 'string' &&
          /^0x[0-9a-f]+$/.test(result.number) &&
          BigInt(result.number) >= 2n
        );
      } catch {
        return false;
      }
    },
    120_000,
  );
  for (const row of rows.filter((row) => row.role !== 'node')) owner.start(row.resource);
  await waitMounted(
    check,
    async () => (await dedicatedIndexerReadiness(ISOLATED_ENDPOINTS)).ready,
    180_000,
  );
  await waitMounted(
    check,
    async () => {
      try {
        return (
          await fetch(ISOLATED_ENDPOINTS.proverUrl + '/health', {
            signal: AbortSignal.timeout(2_000),
          })
        ).ok;
      } catch {
        return false;
      }
    },
    120_000,
  );
  return profile;
}
/** @param {unknown} input @param {string} output @param {NodeJS.ProcessEnv} [env] */
export async function runMounted(input, output, env = process.env) {
  assert.ok(env.IN_NIX_SHELL);
  assert.equal(env.PASSPORT_MOUNTED_NATIVE, '1');
  assert.equal(env.PASSPORT_RC_LOCALNET, '1');
  assert.equal(env.MN_NETWORK_ID, 'undeployed');
  assertIsolationOverrides(env);
  const plan = mountedPlan(input);
  const engine = localDocker();
  const { root, dependencyVolume, serviceId } = await preflightMounted(
    REPOSITORY,
    plan,
    output,
    engine,
  );
  freshRoot(root);
  const runId = randomBytes(8).toString('hex'),
    project = `mn-passport-joblife-${runId}`;
  /** @type {import('./mounted-interval.mjs').IntervalReceipt} */
  const receipt = {
    verdict: 'IN_PROGRESS',
    functional: false,
    inputsUnchanged: false,
    quiescent: false,
    leaseReleased: false,
  };
  /** @type {unknown[]} */ const operations = [];
  const owner = new ResourceOwner(runId, engine.docker, () => save());
  const save = () =>
    saveJournal(root, {
      schema: 1,
      kind: 'mounted-production-source-client',
      runId,
      project,
      plan,
      daemonId: engine.daemonId,
      endpoint: engine.endpoint,
      dependencyVolume,
      resources: owner.resources,
      pending: owner.pending,
      cleanup: owner.cleanupChecks,
      operations,
      receipt,
    });
  const lease = claimReleaseLease({ runId, pid: process.pid, project, root });
  save();
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
  };
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', interrupt);
  const end = performance.now() + 75 * 60_000;
  const check = () => {
    assert.equal(interrupted, false, 'Mounted run interrupted');
    assert.ok(performance.now() < end, 'Mounted work deadline expired');
  };
  const client = mountedClient(REPOSITORY, root, check, (phase) => {
    operations.push({ phase, at: new Date().toISOString() });
    save();
  });
  try {
    let captureCount = 0;
    const cleanupGuard = () =>
      assert.ok(performance.now() < end + 10 * 60_000, 'Mounted cleanup input deadline expired');
    const capture = mountedCapture(REPOSITORY, plan, owner, serviceId, () => {
      if (captureCount === 0) check();
      else cleanupGuard();
    });
    return await mountedInterval({
      owner,
      capture: async () => {
        try {
          return await capture();
        } finally {
          captureCount++;
        }
      },
      stopProcesses: client.stop,
      releaseLease: lease.release,
      verifyDaemon: engine.verify,
      receipt,
      save,
      execute: async () => {
        const profile = await startChain(plan, owner, root, check);
        const services = mountedServices(plan, owner, root, profile.project, check);
        services.initialize();
        await services.service();
        client.start();
        await client.created();
        await services.funding();
        const result = await client.funded();
        return repeatedFunding(services.token, result, (value) => {
          operations.push(value);
          save();
        });
      },
    });
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    put(
      join(root, 'summary.json'),
      JSON.stringify(
        {
          kind: 'mounted-production-source-client',
          source: plan.source,
          runnerSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
          verdict: receipt.verdict,
          functional: receipt.functional,
          inputsUnchanged: receipt.inputsUnchanged,
          quiescent: receipt.quiescent,
          leaseReleased: receipt.leaseReleased,
          resources: owner.resources.map(({ kind, id, createdAt }) => ({ kind, id, createdAt })),
          retainedVolumes: owner.resources.filter((row) => row.kind === 'volume').length + 1,
          syntheticCredentials: true,
          registryInstalledNative: false,
          jobBackedImageFaults: false,
          realProvider: false,
          fullLace: false,
        },
        null,
        2,
      ) + '\n',
    );
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , flag, config, pinFlag, pin, outputFlag, output] = process.argv;
  assert.ok(
    process.argv.length === 8 &&
      flag === '--config' &&
      config &&
      pinFlag === '--sha256' &&
      pin &&
      outputFlag === '--output' &&
      output,
    'Use --config FILE --sha256 INDEPENDENT_CONFIG_SHA256 --output NEW_PRIVATE_ROOT',
  );
  const bytes = readFileSync(config);
  assert.equal(sha256(bytes), pin);
  await runMounted(JSON.parse(bytes.toString()), output);
  console.log('Mounted qualification PASS; private journal and all state retained.');
}
