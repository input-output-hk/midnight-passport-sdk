// Native populated lifecycle over descriptor jobs. All authority remains in private fixtures.
import assert from 'node:assert/strict';
import { join, basename, dirname } from 'node:path';
import { readFile, statfs } from 'node:fs/promises';
import { imageStateNames } from './image-journal-mirror.mjs';
import {
  nativeJobHash,
  nativeJobSnapshot,
  assertNativeJobContinuation,
} from './native-job-evidence.mjs';
import { requireExpectedFailure, requireExpectedHostCrash } from './live-expectations.mjs';
import {
  jobLifecycleStages,
  requireJobLifecycleCompletion,
  requireJobRemovedRefusal,
  requireImageLifecycleReplyLoss,
  requireOriginalLifecycleResume,
} from './job-lifecycle-spec.mjs';
import { runWalletReconnect } from './wallet-reconnect.mjs';

/** The caller owns the bounded process groups, exact container IDs and final cleanup.
 * @param {any} c */
export async function runJobBackedLifecycle(c) {
  const { lane, root, arm } = c;
  const fixtureDigest = nativeJobHash(await readFile(join(root, 'fixture.json')));
  const capacity = async () => {
    const fs = await statfs(root);
    assert.ok(
      fs.bavail * fs.bsize >= 2 * 1024 ** 3,
      'Retain original fixtures; insufficient free host capacity for qualification.',
    );
  };
  await capacity();
  /** @type {any} */ let service;
  const containerId = lane === 'image' ? c.imageContainer(root, arm) : undefined;
  const snapshot = () =>
    containerId ? c.imageSnapshot(containerId, root) : nativeJobSnapshot(root);
  const start = async (fault = 'none', operation = 'create') => {
    await capacity();
    if (containerId) {
      const state = JSON.parse(c.docker(['inspect', containerId]))[0];
      if (!state.State.Running) c.docker(['start', containerId]);
      await c.wait(
        () => c.ready('http://127.0.0.1:18797/healthz'),
        600000,
        () => !JSON.parse(c.docker(['inspect', containerId]))[0].State.Running,
      );
      const health = /** @type {any} */ (
        await (await fetch('http://127.0.0.1:18797/healthz')).json()
      );
      assert.equal(health.hostJobs, true);
    } else service = await c.host(root, arm, fault, operation);
  };
  const stop = async () => {
    if (containerId) {
      if (JSON.parse(c.docker(['inspect', containerId]))[0].State.Running)
        c.docker(['stop', '--time', '35', containerId]);
    } else if (service) {
      c.kill(service.child);
      await c.finished(service, 15000);
      service = undefined;
    }
  };
  let previous = await nativeJobSnapshot(root);
  /** @param {string} operation @param {any} owner @param {Record<string,any>} [extra] */
  const record = async (operation, owner, extra = {}) => {
    const current = await snapshot();
    assertNativeJobContinuation(previous, current);
    previous = current;
    c.cases.push({
      arm,
      operation,
      verdict: 'PASS',
      owner,
      snapshot: current,
      ...(containerId && { containerId }),
      ...extra,
    });
    await c.save();
  };
  await start();
  const created = await c.finished(
    c.worker('owner', root, arm, 'create', 'none'),
    c.options.ownerTimeoutMs,
  );
  requireJobLifecycleCompletion(created, 'create');
  await record('create', created);
  await stop();
  // Only one standalone sponsor wallet may exist. Grant/faucet/deposit setup is not job-backed.
  await capacity();
  const populated = await c.finished(
    c.worker('populate', root, arm, 'populate', 'none'),
    30 * 60000,
  );
  assert.equal(
    populated.code,
    0,
    'Fresh standalone grant/holding setup must settle; never retry uncertain deposits.',
  );
  const p = populated.messages.filter((/** @type {any} */ m) => m.completed === 'populate');
  assert.equal(p.length, 1);
  assert.equal(p[0].populated?.heldCoins, 1);
  assert.equal(p[0].populated?.activeReadGrants, 1);
  assert.equal(p[0].populated?.grantOpenedCurrentKey, true);
  // Setup must not pretend that its direct grant/deposit callbacks are durable host jobs.
  assert.deepEqual(await nativeJobSnapshot(root), previous);
  c.cases.push({
    arm,
    operation: 'populate',
    verdict: 'PASS',
    setupUsesHostJobs: false,
    owner: populated,
  });
  await c.save();
  for (const stage of jobLifecycleStages(arm)) {
    const started = Date.now(),
      before = previous;
    if (stage.circuit) {
      /** @type {any} */ let interruptedOwner;
      if (lane === 'source') {
        const fault = `circuit:${stage.circuit}:after-submit`;
        await start(fault, stage.operation);
        const interrupted = await c.finished(
          c.worker('owner', root, arm, stage.operation, 'none'),
          c.options.ownerTimeoutMs,
        );
        interruptedOwner = interrupted;
        requireExpectedFailure(interrupted, stage.operation, fault, arm);
        // The host marker names the circuit fault even for the survivor's first call.
        requireExpectedHostCrash(await c.finished(service, 15000), fault);
        service = undefined;
        await c.probe(root, arm);
        await record(stage.operation, interrupted, {
          fault,
          boundary: 'native-after-submit-before-owner-ack',
          durationMs: Date.now() - started,
        });
      } else {
        await start();
        const interrupted = await c.finished(
          c.worker('owner', root, arm, stage.operation, `image-reply:${stage.circuit}`),
          c.options.ownerTimeoutMs,
        );
        interruptedOwner = interrupted;
        const atLoss = await snapshot();
        requireImageLifecycleReplyLoss(interrupted, stage.operation, stage.circuit, before, atLoss);
        c.docker(['kill', '--signal', 'KILL', containerId]);
        await start();
        const retained = await snapshot();
        assertNativeJobContinuation(atLoss, retained);
        assert.deepEqual(
          retained,
          atLoss,
          'Restart must retain completed original jobs without executing replacements.',
        );
        await record(stage.operation, interrupted, {
          circuit: stage.circuit,
          boundary: 'owner-confirmed-result-observer-loss-then-container-kill',
          durationMs: Date.now() - started,
        });
      }
      if (lane === 'source') await start('none', stage.operation);
      const completed = await c.finished(
        c.worker('resume', root, arm, stage.operation, 'none'),
        c.options.ownerTimeoutMs,
      );
      requireJobLifecycleCompletion(completed, stage.operation);
      requireOriginalLifecycleResume(interruptedOwner, completed, stage.operation);
      await record(stage.operation, completed, { resumedOriginal: true });
    } else {
      await start();
      const completed = await c.finished(
        c.worker('owner', root, arm, stage.operation, 'none'),
        c.options.ownerTimeoutMs,
      );
      requireJobLifecycleCompletion(completed, stage.operation);
      await record(stage.operation, completed);
    }
    await stop();
  }
  const verify = async (afterWallet = false) => {
    await start();
    const before = await snapshot();
    const verified = await c.finished(
      c.worker('owner', root, arm, 'verify-removed', 'none'),
      120000,
    );
    requireJobRemovedRefusal(verified);
    assert.deepEqual(
      await snapshot(),
      before,
      'Removed-reader check must not register/update jobs or mutate the host.',
    );
    await record('verify-removed', verified, { afterWallet });
    await stop();
  };
  await verify();
  // Both the actual service sponsor and the previous standalone setup wallet are stopped.
  await capacity();
  const wallet = await runWalletReconnect({
    root: join(root, 'wallet'),
    ownerArm: arm,
    worker: c.worker,
    finished: c.finished,
    waitFor: c.wait,
    docker: c.docker,
    indexerId: c.ids[1],
    indexerReady: c.indexerReady,
  });
  c.cases.push({
    arm,
    ...wallet,
    ownerSeedPinned: true,
    walletScope:
      'actual-built-in-wallet-from-synthetic-account-owner-key-source; standalone-payer-credit',
  });
  await c.save();
  await verify(true);
  const final = await snapshotAfterStop();
  async function snapshotAfterStop() {
    // The final observer mirror is already current from verify; service is stopped now.
    return nativeJobSnapshot(root);
  }
  assert.equal(
    nativeJobHash(await readFile(join(root, 'fixture.json'))),
    fixtureDigest,
    'Lifecycle/wallet must retain the original owner material.',
  );
  assert.ok(final.jobs.length > 4 && final.jobs.every((j) => j.state === 'done'));
  assert.equal(final.dispatchClaims, final.confirmed);
  if (containerId) {
    const image = JSON.parse(c.docker(['inspect', containerId]))[0];
    assert.equal(image.Image, c.imageId);
    assert.equal(image.Config.User, `${process.getuid?.()}:${process.getgid?.()}`);
    assert.deepEqual(image.Config.Entrypoint, [
      '/opt/passport/apps/passport-service/image-entrypoint.sh',
    ]);
    assert.equal(image.Mounts.filter((/** @type {any} */ m) => m.RW).length, 1);
    const state = image.Mounts.find((/** @type {any} */ m) => m.Destination === '/data/state');
    assert.ok(state?.Type === 'volume' && state.RW);
    assert.equal(state.Name, imageStateNames(basename(dirname(root)), arm, 'lifecycle').volume);
    for (const path of [
      '/data/contract',
      '/data/contract/node_modules',
      '/private/host-key',
      '/private/host-token',
      '/private/job-key',
      '/private/job-token',
    ])
      assert.ok(image.Mounts.some((/** @type {any} */ m) => m.Destination === path && !m.RW));
    c.cases.push({
      arm,
      operation: 'lifecycle-final',
      ownerFixtureUnchanged: true,
      verdict: 'PASS',
      snapshot: final,
      containerId,
      mounts: image.Mounts.map((/** @type {any} */ m) => ({
        type: m.Type,
        destination: m.Destination,
        readOnly: !m.RW,
        ...(m.Type === 'volume' && { volume: m.Name }),
      })),
    });
  } else
    c.cases.push({
      arm,
      operation: 'lifecycle-final',
      ownerFixtureUnchanged: true,
      verdict: 'PASS',
      snapshot: final,
    });
  await c.save();
}
