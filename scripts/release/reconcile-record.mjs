// Closed admission for new schema-2 runs. Older private helpers are never adopted.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readPrivate } from './process-files.mjs';
import { object, exact, text } from './files.mjs';
import { mountedPlan } from './mounted-plan.mjs';
import { admitProcessIdentity } from './process-identity.mjs';

/** @param {unknown} input */
export function leasePin(input) {
  const row = object(input);
  exact(row, ['dev', 'ino', 'sha256']);
  for (const field of ['dev', 'ino'])
    assert.ok(Number.isSafeInteger(row[field]) && Number(row[field]) >= 0);
  return { dev: Number(row.dev), ino: Number(row.ino), sha256: text(row.sha256, /^[a-f0-9]{64}$/) };
}
/** @param {unknown} input @param {string} runId @returns {import('./resources.mjs').Intent} */
function pendingResource(input, runId) {
  if (input === null) return null;
  const row = object(input);
  exact(row, ['kind', 'name', 'image']);
  const kind = row.kind;
  assert.ok(kind === 'container' || kind === 'volume' || kind === 'network');
  const name = text(row.name, /^[a-z0-9][a-z0-9-]{1,120}$/);
  assert.ok(
    name.startsWith(`mn-passport-joblife-${runId}`) || name.startsWith(`passport-${runId}-`),
  );
  const image = text(row.image, kind === 'container' ? /^sha256:[a-f0-9]{64}$/ : /^$/);
  return { kind, name, image };
}
/** @param {unknown} input @param {string} runId @returns {import('./resources.mjs').Resource} */
function resource(input, runId) {
  const row = object(input);
  exact(row, [
    'kind',
    'name',
    'image',
    'id',
    'createdAt',
    'startAttempted',
    'startConfirmed',
    'startBaseline',
  ]);
  const intent = pendingResource({ kind: row.kind, name: row.name, image: row.image }, runId);
  assert.ok(intent);
  assert.equal(typeof row.startAttempted, 'boolean');
  assert.equal(typeof row.startConfirmed, 'boolean');
  assert.ok(row.startConfirmed || row.startAttempted);
  return {
    ...intent,
    id: text(row.id, intent.kind === 'volume' ? /^[a-z0-9-]+$/ : /^[a-f0-9]{64}$/),
    createdAt: text(
      row.createdAt,
      intent.kind === 'volume' ? /^\d{4}-\d{2}-\d{2}T[^\r\n]+Z$/ : /^$/,
    ),
    startAttempted: row.startAttempted === true,
    startConfirmed: row.startConfirmed === true,
    startBaseline: text(
      row.startBaseline,
      row.startAttempted ? /^\d{4}-\d{2}-\d{2}T[^\r\n]+Z$/ : /^$/,
    ),
  };
}
/** @param {string} root @param {string} expected */
export function admitMountedJournal(root, expected) {
  const file = readPrivate(join(root, 'journal.json'), 4 * 1024 ** 2);
  assert.equal(file.sha256, expected, 'Independently pinned original journal differs');
  const row = object(JSON.parse(file.bytes.toString('utf8')));
  exact(row, [
    'schema',
    'kind',
    'runId',
    'project',
    'plan',
    'daemonId',
    'endpoint',
    'dependencyVolume',
    'controller',
    'leaseIdentity',
    'clientLaunch',
    'resources',
    'pending',
    'cleanup',
    'operations',
    'receipt',
  ]);
  assert.equal(
    row.schema,
    2,
    'Legacy runs need manual reconciliation; no captured process/lease identity',
  );
  assert.equal(row.kind, 'mounted-production-source-client');
  const runId = text(row.runId, /^[a-f0-9]{16}$/),
    project = `mn-passport-joblife-${runId}`;
  assert.equal(row.project, project);
  const plan = mountedPlan({ ...object(row.plan), schemaVersion: 1 });
  const controller = admitProcessIdentity(row.controller);
  if (process.getuid) assert.equal(controller.uid, process.getuid());
  const dependencyVolume = object(row.dependencyVolume);
  exact(dependencyVolume, ['name', 'createdAt']);
  assert.equal(dependencyVolume.name, plan.linuxDependencies.volume);
  const client = row.clientLaunch === null ? null : object(row.clientLaunch);
  if (client) {
    exact(client, ['directory', 'launchSha256']);
    assert.equal(client.directory, join(root, 'client-process'));
  }
  assert.ok(Array.isArray(row.resources) && row.resources.length <= 64);
  const resources = row.resources.map((value) => resource(value, runId));
  assert.equal(new Set(resources.map((r) => `${r.kind}:${r.id}`)).size, resources.length);
  assert.equal(new Set(resources.map((r) => `${r.kind}:${r.name}`)).size, resources.length);
  const receipt = object(row.receipt);
  assert.equal(receipt.verdict, 'IN_PROGRESS', 'Completed/failed runs are not hard-kill takeovers');
  assert.ok(Array.isArray(row.operations) && Array.isArray(row.cleanup));
  return {
    root,
    file: { sha256: file.sha256, dev: file.dev, ino: file.ino },
    runId,
    project,
    plan,
    controller,
    leaseIdentity: leasePin(row.leaseIdentity),
    daemonId: text(row.daemonId, /^[A-Za-z0-9:-]{1,128}$/),
    endpoint: text(row.endpoint, /^unix:\/\/\/[^\r\n]{1,2048}$/),
    dependencyVolume: {
      name: String(dependencyVolume.name),
      createdAt: text(dependencyVolume.createdAt, /^\d{4}-\d{2}-\d{2}T[^\r\n]+Z$/),
    },
    client: client
      ? {
          directory: String(client.directory),
          launchSha256: text(client.launchSha256, /^[a-f0-9]{64}$/),
        }
      : null,
    resources,
    pending: pendingResource(row.pending, runId),
    before: receipt.before,
  };
}
