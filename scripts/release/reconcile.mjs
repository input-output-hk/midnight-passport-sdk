#!/usr/bin/env node
// Explicit original-run cleanup only: never creation, submission, GO or account resume.
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { admitReconciliation } from './reconcile-preflight.mjs';
import { claimReconciliation } from './reconcile-claim.mjs';
import { observeProcess, processIdentityHash } from './process-identity.mjs';
import { readProcessLaunch } from './process-launch.mjs';
import { closeRecordedProcess } from './process-close.mjs';
import { ResourceOwner, releaseRecordedLease } from './resources.mjs';
import { put, saveJournal, syncDirectory } from './files.mjs';
import { mountedCapture } from './mounted-inputs.mjs';
import { mountedCapacity } from './mounted-preflight.mjs';
import { reconciliationInterval } from './reconcile-interval.mjs';

const REPOSITORY = realpathSync(resolve(import.meta.dirname, '../..'));
/** @param {string} root @param {string} expected @param {NodeJS.ProcessEnv} [env] */
export async function reconcileMounted(root, expected, env = process.env) {
  const { original, owner, engine, serviceImage, leasePath, verifyOriginal } = admitReconciliation(
    root,
    expected,
    env,
  );
  const controller = observeProcess(process.pid);
  assert.ok(controller);
  const claim = claimReconciliation(root, expected, original.leaseIdentity, controller);
  /** @type {import('./reconcile-interval.mjs').ReconcileReceipt} */
  const receipt = {
    verdict: 'IN_PROGRESS',
    functional: false,
    clientClosed: false,
    quiescent: false,
    inputsUnchanged: false,
    leaseReleased: false,
    before: original.before,
  };
  const resources = new ResourceOwner(original.runId, engine.docker, () => save());
  resources.resources = original.resources.map((row) => ({ ...row }));
  resources.pending = original.pending;
  const save = () => {
    claim.verify();
    saveJournal(claim.path, {
      schema: 1,
      kind: 'mounted-interruption-reconciliation',
      originalJournalSha256: expected,
      source: original.plan.source,
      controller,
      originalController: original.controller,
      originalLease: original.leaseIdentity,
      resources: resources.resources,
      pending: resources.pending,
      cleanup: resources.cleanupChecks,
      receipt,
    });
  };
  const verify = () => {
    claim.verify();
    verifyOriginal();
  };
  save();
  const end = performance.now() + 10 * 60_000;
  const collect = mountedCapture(
    REPOSITORY,
    original.plan,
    resources,
    serviceImage.Id,
    () => assert.ok(performance.now() < end, 'Reconciliation input deadline expired'),
    `reconcile-${controller.pid}-deps`,
  );
  const capture = () => {
    mountedCapacity(root, engine.info.MemTotal);
    return collect();
  };
  try {
    return await reconciliationInterval({
      owner: resources,
      verify,
      capture,
      receipt,
      save,
      closeClient: async () => {
        if (!original.client) return !existsSync(join(root, 'client-process'));
        const launch = readProcessLaunch(
          original.client.directory,
          original.client.launchSha256,
          false,
        );
        try {
          assert.equal(launch.launch.runId, original.runId);
          assert.equal(launch.launch.root, root);
          assert.equal(launch.launch.program, join(REPOSITORY, 'scripts/qualify-rc-localnet.mjs'));
          assert.equal(
            processIdentityHash(launch.launch.controller),
            processIdentityHash(original.controller),
          );
        } finally {
          launch.key.fill(0);
        }
        return (await closeRecordedProcess(original.client.directory, original.client.launchSha256))
          .closed;
      },
      releaseLease: (safe) => releaseRecordedLease(owner, original.leaseIdentity, safe, leasePath),
    });
  } finally {
    put(
      join(claim.path, 'summary.json'),
      JSON.stringify(
        {
          kind: 'mounted-interruption-reconciliation',
          source: original.plan.source,
          originalJournalSha256: expected,
          ...receipt,
          originalRunRewritten: false,
          newAccountOrFundingRequests: 0,
          externalSignals: 0,
          registryInstalledNative: false,
          realProvider: false,
          fullLace: false,
        },
        null,
        2,
      ) + '\n',
    );
    syncDirectory(claim.path);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [, , flag, root, hashFlag, expected] = process.argv;
  assert.ok(
    process.argv.length === 6 &&
      flag === '--original' &&
      hashFlag === '--sha256' &&
      root &&
      expected,
  );
  await reconcileMounted(root, expected);
}
