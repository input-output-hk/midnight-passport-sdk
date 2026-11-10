// Read-only preflight must finish before a lease or Docker resource is acquired.
import assert from 'node:assert/strict';
import { existsSync, statfsSync } from 'node:fs';
import { dirname } from 'node:path';
import { workspaceIdentity } from '../qualification/receipt.mjs';
import { sessionOutputPath } from '../qualification/session-profile.mjs';
import { isolatedFreePort } from '../qualification/live-isolated-job-lifecycle.mjs';
import { ISOLATED_PORTS } from '../qualification/native-isolation-profile.mjs';
import { MOUNTED_PORTS } from './mounted-plan.mjs';
import { command } from './process.mjs';

/** @param {string} output @param {number} memory @param {()=>bigint} [diskBytes] */
export function mountedCapacity(output, memory, diskBytes) {
  const disk = statfsSync(dirname(output));
  assert.ok(
    (diskBytes?.() ?? BigInt(disk.bavail) * BigInt(disk.bsize)) >= 15n * 1024n ** 3n,
    '15 GiB free disk required',
  );
  assert.ok(memory >= 24 * 1024 ** 3, '24 GiB Docker memory required');
}

/** @param {string} repository @param {string} expected */
async function sourceCheck(repository, expected) {
  const source = await workspaceIdentity(repository);
  assert.equal(source.commit, expected);
  assert.equal(source.dirty, false);
  assert.equal(
    command('git', ['log', '-1', '--format=%G?'], { cwd: repository }).stdout.trim(),
    'G',
    'Freeze a trusted signed runner before native work',
  );
}
/** Test seams replace only read-only probes; no caller-supplied create/start/cleanup hooks.
 * @param {string} repository @param {ReturnType<import('./mounted-plan.mjs').mountedPlan>} plan @param {string} output
 * @param {{docker:import('./resources.mjs').Docker,info:{MemTotal:number}}} engine
 * @param {{freePort?:typeof isolatedFreePort,source?:typeof sourceCheck,diskBytes?:()=>bigint}} [probes] */
export async function preflightMounted(repository, plan, output, engine, probes = {}) {
  const root = sessionOutputPath(output, [repository, plan.contract]);
  assert.equal(existsSync(root), false, 'Occupied attempt must be reconciled, never overwritten');
  mountedCapacity(root, engine.info.MemTotal, probes.diskBytes);
  await (probes.source ?? sourceCheck)(repository, plan.source);
  const dependencyVolume = JSON.parse(
    engine.docker(['volume', 'inspect', plan.linuxDependencies.volume]).stdout,
  )[0];
  assert.equal(dependencyVolume.Name, plan.linuxDependencies.volume);
  for (const pin of plan.images) {
    const image = JSON.parse(
      engine.docker(['image', 'inspect', `${pin.repository}@${pin.digest}`]).stdout,
    )[0];
    assert.ok(image.RepoDigests?.includes(`${pin.repository}@${pin.digest}`));
    assert.ok(
      image.Os === 'linux' &&
        image.Architecture === 'amd64' &&
        image.Config?.User === '10001:10001',
    );
    assert.match(String(image.Id), /^sha256:[a-f0-9]{64}$/);
  }
  for (const pin of plan.chainImages) {
    const image = JSON.parse(engine.docker(['image', 'inspect', pin.tag]).stdout)[0];
    assert.equal(image.Id, pin.id);
    assert.equal(image.Os, 'linux');
  }
  await Promise.all(
    [
      ISOLATED_PORTS.node,
      ISOLATED_PORTS.indexer,
      ISOLATED_PORTS.prover,
      ...Object.values(MOUNTED_PORTS),
    ].map(probes.freePort ?? isolatedFreePort),
  );
  const servicePin = plan.images.find((row) => row.role === 'service');
  assert.ok(servicePin);
  const image = JSON.parse(
    engine.docker(['image', 'inspect', `${servicePin.repository}@${servicePin.digest}`]).stdout,
  )[0];
  return {
    root,
    dependencyVolume: {
      name: String(dependencyVolume.Name),
      createdAt: String(dependencyVolume.CreatedAt),
    },
    serviceId: String(image.Id),
  };
}
