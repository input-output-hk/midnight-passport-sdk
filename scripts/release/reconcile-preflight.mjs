// Read-only admission before any reconciliation claim or resource control.
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { admitMountedJournal } from './reconcile-record.mjs';
import { originalProcessAlive } from './process-identity.mjs';
import { readPrivate } from './process-files.mjs';
import { privateDirectory } from './files.mjs';
import { nativeLeasePath } from '../qualification/native-lease.mjs';
import { localDocker } from './docker.mjs';

/** @param {string} root @param {string} expected @param {NodeJS.ProcessEnv} env */
export function admitReconciliation(root, expected, env) {
  assert.equal(env.PASSPORT_RECONCILE_MOUNTED, '1');
  assert.equal(env.PASSPORT_RC_LOCALNET, '1');
  assert.equal(env.MN_NETWORK_ID, 'undeployed');
  assert.ok(env.IN_NIX_SHELL);
  assert.equal(realpathSync(root), root);
  privateDirectory(root);
  const original = admitMountedJournal(root, expected);
  assert.equal(
    originalProcessAlive(original.controller),
    false,
    'Original controller is still live',
  );
  const owner = {
      runId: original.runId,
      pid: original.controller.pid,
      project: original.project,
      root,
    },
    leasePath = nativeLeasePath();
  const verifyLease = () => {
    const current = readPrivate(leasePath, 4096);
    assert.equal(current.dev, original.leaseIdentity.dev);
    assert.equal(current.ino, original.leaseIdentity.ino);
    assert.equal(current.sha256, original.leaseIdentity.sha256);
    assert.deepEqual(JSON.parse(current.bytes.toString('utf8')), owner);
  };
  verifyLease();
  const engine = localDocker();
  assert.equal(engine.endpoint, original.endpoint);
  assert.equal(engine.daemonId, original.daemonId);
  const service = original.plan.images.find((row) => row.role === 'service');
  assert.ok(service);
  const serviceImage = JSON.parse(
    engine.docker(['image', 'inspect', `${service.repository}@${service.digest}`]).stdout,
  )[0];
  assert.ok(serviceImage.RepoDigests?.includes(`${service.repository}@${service.digest}`));
  const verifyOriginal = () => {
    engine.verify();
    verifyLease();
    const current = readPrivate(join(root, 'journal.json'), 4 * 1024 ** 2);
    assert.equal(current.sha256, expected);
    assert.equal(current.dev, original.file.dev);
    assert.equal(current.ino, original.file.ino);
    assert.equal(originalProcessAlive(original.controller), false);
  };
  return { original, owner, engine, serviceImage, leasePath, verifyOriginal };
}
