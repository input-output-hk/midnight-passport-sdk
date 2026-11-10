#!/usr/bin/env node
// Read-only release acceptance: downloads/installs/probes, never publishes or rewrites tags.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workspaceIdentity } from '../qualification/receipt.mjs';
import { sessionOutputPath } from '../qualification/session-profile.mjs';
import { freshRoot, put, saveJournal, sha256 } from './files.mjs';
import { releasePlan } from './plan.mjs';
import { acceptRegistry } from './registry.mjs';
import { installRegistryConsumer } from './installation.mjs';
import { acceptImages } from './images.mjs';
import { acceptPages } from './pages.mjs';
import { acceptInstructions } from './instructions.mjs';
import { verifySignedTag } from './signatures.mjs';
import { ResourceOwner } from './resources.mjs';
import { localDocker } from './docker.mjs';
import { backendSmoke } from './image-runtime.mjs';
import { keyRuntime } from './key-runtime.mjs';
import { command } from './process.mjs';
import { acceptReproducibility } from './reproducibility.mjs';
import { acceptPublication, matchPublishedPackages } from './publication.mjs';
import { imageInterval } from './fences.mjs';

const REPOSITORY = realpathSync(resolve(import.meta.dirname, '../..'));
/** @param {unknown} input @param {'registry'|'images'|'pages'|'all'} lane @param {string} output */
export async function acceptRelease(input, lane, output) {
  assert.ok(
    process.env.IN_NIX_SHELL && process.env.PASSPORT_RELEASE_ACCEPTANCE === '1',
    'Explicit release acceptance opt-in required',
  );
  assert.ok(['registry', 'images', 'pages', 'all'].includes(lane));
  const plan = releasePlan(input);
  const before = await workspaceIdentity(REPOSITORY);
  assert.equal(before.dirty, false, 'Freeze runner source before actual acceptance');
  assert.equal(
    command('git', ['log', '-1', '--format=%G?'], { cwd: REPOSITORY }).stdout.trim(),
    'G',
    'Trusted signed runner head required',
  );
  const root = sessionOutputPath(output, [
    REPOSITORY,
    plan.sourceBundle,
    plan.documentationCheckout,
    plan.publicKeys,
  ]);
  freshRoot(root);
  /** @type {Record<string,unknown>} */ const checks = {};
  const state = {
    kind: 'release-acceptance',
    lane,
    version: plan.version,
    sdkSource: plan.source,
    publisherSource: plan.publisher.source,
    documentationSource: plan.pages.head,
    runner: before,
    verdict: 'IN_PROGRESS',
    checks,
    failureType: '',
    runnerInputsUnchanged: false,
    cleanupComplete: true,
    registryInstalledNative: false,
    realProvider: false,
    fullLace: false,
  };
  const save = () => saveJournal(root, state);
  save();
  let failure;
  try {
    checks.signatures = plan.tags.map(verifySignedTag);
    save();
    const publication = acceptPublication(plan, root);
    checks.publication = publication;
    save();
    if (lane === 'registry' || lane === 'all') {
      checks.reproducibility = acceptReproducibility(REPOSITORY, plan, root);
      save();
      const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
      assert.ok(token, 'Authorized GitHub package credential required');
      const registry = await acceptRegistry(plan, root, token);
      matchPublishedPackages(registry.packages, publication.publication.packages);
      checks.registry = registry;
      save();
      checks.installation = await installRegistryConsumer(REPOSITORY, root, plan.version, token);
      save();
    }
    if (lane === 'images' || lane === 'all') {
      const engine = localDocker();
      const pulled = await acceptImages(plan.images, root, engine);
      checks.images = pulled;
      save();
      const runId = randomBytes(8).toString('hex');
      const owner = new ResourceOwner(runId, engine.docker, () =>
        saveJournal(root + '/image-runtime', {
          runId,
          daemonId: engine.daemonId,
          resources: owner.resources,
          pending: owner.pending,
          cleanup: owner.cleanupChecks,
        }),
      );
      freshRoot(root + '/image-runtime');
      state.cleanupComplete = false;
      save();
      await imageInterval(
        owner,
        engine.verify,
        async () => {
          checks.startup = backendSmoke(REPOSITORY, root + '/image-runtime', owner, pulled);
          const keys = pulled.find((row) => row.role === 'keys');
          assert.ok(keys);
          checks.keyRuntime = await keyRuntime(plan, root + '/image-runtime', owner, keys);
          save();
        },
        (complete) => {
          state.cleanupComplete = complete;
          save();
        },
      );
    }
    if (lane === 'pages' || lane === 'all') {
      checks.instructions = acceptInstructions(
        plan.documentationCheckout,
        plan.pages.head,
        plan.version,
        plan.images,
      );
      save();
      checks.pages = await acceptPages(plan.pages, root, plan.images);
      save();
    }
  } catch (error) {
    failure = error;
    state.failureType = error instanceof Error ? error.name : 'UnknownFailure';
  } finally {
    try {
      assert.deepEqual(await workspaceIdentity(REPOSITORY), before);
      state.runnerInputsUnchanged = true;
    } catch (error) {
      failure ??= error;
    }
    state.verdict =
      failure === undefined && state.runnerInputsUnchanged && state.cleanupComplete
        ? 'PASS'
        : 'FAIL';
    save();
    put(join(root, 'receipt.json'), JSON.stringify(state, null, 2) + '\n');
  }
  if (failure !== undefined)
    throw Error('Release acceptance failed; inspect preserved private journal');
  return state;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , flag, config, pinFlag, pin, laneFlag, lane, outputFlag, output] = process.argv;
  assert.ok(
    process.argv.length === 10 &&
      flag === '--config' &&
      config &&
      pinFlag === '--sha256' &&
      pin &&
      laneFlag === '--lane' &&
      ['registry', 'images', 'pages', 'all'].includes(lane ?? '') &&
      outputFlag === '--output' &&
      output,
    'Use --config FILE --sha256 CONFIG_SHA256 --lane registry|images|pages|all --output NEW_PRIVATE_ROOT',
  );
  const bytes = readFileSync(config);
  assert.equal(sha256(bytes), pin);
  const receipt = await acceptRelease(
    JSON.parse(bytes.toString()),
    /** @type {'registry'|'images'|'pages'|'all'} */ (lane),
    output,
  );
  console.log(`Release acceptance ${receipt.lane} PASS; no publication performed.`);
}
