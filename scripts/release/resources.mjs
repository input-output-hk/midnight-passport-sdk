// Write-ahead resource ownership. Names reconcile lost replies, never authorize unrecorded control.
import assert from 'node:assert/strict';
import { existsSync, lstatSync } from 'node:fs';
import { dirname } from 'node:path';
import { nativeLeasePath } from '../qualification/native-lease.mjs';
import { readPrivate } from './process-files.mjs';
import {
  claimIsolationLease,
  releaseIsolationLease,
} from '../qualification/native-isolation-files.mjs';
import { object, syncDirectory, text } from './files.mjs';

/** @typedef {'container'|'volume'|'network'} Kind */
/** @typedef {{kind:Kind,name:string,image:string,id:string,createdAt:string,startAttempted:boolean,startConfirmed:boolean,startBaseline:string}} Resource */
/** @typedef {{kind:Kind,name:string,image:string}|null} Intent */
/** @typedef {{stdout:string,stderr:string,status:number}} Result */
/** @typedef {(args:string[],options?:{input?:string|undefined,allowFailure?:boolean|undefined})=>Result} Docker */
/** @param {string} output */
function single(output) {
  const rows = JSON.parse(output);
  assert.ok(Array.isArray(rows) && rows.length === 1);
  return object(rows[0]);
}
/** @param {Kind} kind @param {string} name */
const inspection = (kind, name) =>
  kind === 'container' ? ['inspect', name] : [kind, 'inspect', name];

/** Docker 29 uses a distinct network diagnostic; transport failure never proves absence.
 * @param {Kind} kind @param {string} name @param {Result} result */
export function resourceAbsent(kind, name, result) {
  if (result.status !== 1 || !['', '[]'].includes(result.stdout.trim())) return false;
  const message = result.stderr.trim().toLowerCase();
  const allowed = [
    `error: no such ${kind}: ${name}`,
    `error response from daemon: no such ${kind}: ${name}`,
  ];
  if (kind === 'container') allowed.push(`error: no such object: ${name}`);
  if (kind === 'volume') allowed.push(`error response from daemon: get ${name}: no such volume`);
  if (kind === 'network') allowed.push(`error response from daemon: network ${name} not found`);
  return allowed.includes(message);
}

export class ResourceOwner {
  /** @type {Resource[]} */ resources = [];
  /** @type {Intent} */ pending = null;
  /** @type {Array<{name:string,ok:boolean}>} */ cleanupChecks = [];
  /** @param {string} runId @param {Docker} docker @param {()=>void} save */
  constructor(runId, docker, save) {
    this.runId = text(runId, /^[a-f0-9]{16}$/);
    this.docker = docker;
    this.save = save;
  }
  /** @param {Resource} row */
  inspect(row) {
    assert.ok(this.resources.includes(row), 'Resource was not allocated by this run');
    const current = single(
      this.docker(inspection(row.kind, row.kind === 'volume' ? row.name : row.id)).stdout,
    );
    const labels = object(
      row.kind === 'container' ? object(current.Config).Labels : current.Labels,
    );
    assert.equal(labels['passport.acceptance.run'], this.runId, 'Ownership label differs');
    assert.equal(row.kind === 'volume' ? current.Name : current.Id, row.id);
    if (row.kind === 'container') {
      assert.equal(String(current.Name).replace(/^\//, ''), row.name);
      assert.equal(current.Image, row.image, 'Container image changed');
      assert.equal(object(current.HostConfig).AutoRemove, false, 'Auto-removal loses evidence');
      const state = object(current.State);
      assert.equal(typeof state.Running, 'boolean');
      text(state.StartedAt, /^\d{4}-\d{2}-\d{2}T[^\r\n]+Z$/);
    } else assert.equal(current.Name, row.name);
    if (row.kind === 'volume') assert.equal(current.CreatedAt, row.createdAt, 'Volume replaced');
    if (row.kind === 'network')
      assert.ok(
        Object.keys(object(current.Containers)).every((id) =>
          this.resources.some((resource) => resource.kind === 'container' && resource.id === id),
        ),
        'Unowned network attachment',
      );
    return current;
  }
  /** @param {Kind} kind @param {string} name @param {string[]} args @param {string} [image] */
  create(kind, name, args, image = '') {
    assert.equal(this.pending, null, 'Unresolved allocation blocks subsequent creation');
    assert.ok(
      this.resources.every((row) => row.startConfirmed),
      'Unresolved start blocks subsequent creation',
    );
    text(name, /^[a-z0-9][a-z0-9-]{1,120}$/);
    if (kind === 'container') text(image, /^sha256:[a-f0-9]{64}$/);
    const existing = this.docker(inspection(kind, name), { allowFailure: true });
    assert.ok(
      resourceAbsent(kind, name, existing),
      'Resource exists or absence could not be established',
    );
    this.pending = { kind, name, image };
    this.save(); // MUST precede the possibly side-effecting command.
    const label = ['--label', `passport.acceptance.run=${this.runId}`];
    const command =
      kind === 'container'
        ? ['create', '--pull', 'never', '--name', name, ...label, ...args]
        : [kind, 'create', ...label, name];
    this.docker(command);
    return this.reconcile();
  }
  /** Explicitly resolves only the recorded allocation. An absent/uncertain response remains pending. */
  reconcile() {
    assert.ok(this.pending, 'No pending allocation');
    const intent = this.pending;
    const current = single(this.docker(inspection(intent.kind, intent.name)).stdout);
    const labels = object(
      intent.kind === 'container' ? object(current.Config).Labels : current.Labels,
    );
    assert.equal(labels['passport.acceptance.run'], this.runId, 'Refuse unowned allocation');
    const id = text(
      intent.kind === 'volume' ? current.Name : current.Id,
      intent.kind === 'volume' ? /^[a-z0-9-]+$/ : /^[a-f0-9]{64}$/,
    );
    const row = this.resources.find(
      (resource) => resource.id === id && resource.kind === intent.kind,
    ) ?? {
      ...intent,
      id,
      createdAt: intent.kind === 'volume' ? String(current.CreatedAt) : '',
      startAttempted: false,
      startConfirmed: true,
      startBaseline: '',
    };
    if (!this.resources.includes(row)) this.resources.push(row);
    this.inspect(row); // Failed identity admission retains pending and the captured ID.
    this.pending = null;
    this.save();
    return row;
  }
  /** @param {Resource} row @param {{attach?:boolean,input?:string|undefined}} [options] */
  start(row, options = {}) {
    assert.equal(this.pending, null);
    assert.ok(
      this.resources.every((resource) => resource.startConfirmed),
      'Unresolved start blocks subsequent starts',
    );
    assert.equal(row.kind, 'container');
    const before = object(this.inspect(row).State);
    assert.equal(before.Running, false, 'Refuse to start an already running owned process');
    row.startBaseline = text(before.StartedAt, /^.+$/);
    row.startAttempted = true;
    row.startConfirmed = false;
    this.save(); // A lost start reply cannot erase this intent.
    const result = this.docker(
      [
        'start',
        ...(options.attach ? ['--attach'] : []),
        ...(options.input !== undefined ? ['--interactive'] : []),
        row.id,
      ],
      { input: options.input, allowFailure: options.attach },
    );
    const state = object(this.inspect(row).State);
    assert.equal(typeof state.Running, 'boolean');
    assert.notEqual(
      state.StartedAt,
      row.startBaseline,
      'Start did not establish a new process identity',
    );
    row.startConfirmed = true;
    this.save();
    return result;
  }
  /** @param {Resource} row */
  stop(row) {
    assert.equal(row.kind, 'container');
    const current = this.inspect(row);
    // An in-flight start may take effect after an earlier created/stopped snapshot.
    // Only observation of this attempt's new start can reconcile the lost reply.
    if (row.startAttempted && !row.startConfirmed)
      assert.notEqual(
        object(current.State).StartedAt,
        row.startBaseline,
        'Start outcome remains unknown; retain its lease',
      );
    if (object(current.State).Running) this.docker(['stop', '--time', '20', row.id]);
    assert.equal(object(this.inspect(row).State).Running, false, 'Owned compute is not quiescent');
    row.startConfirmed = true;
    this.save();
  }
  /** Includes never-started init/fingerprint helpers and every original state volume. */
  cleanup() {
    this.cleanupChecks = [];
    for (const row of [...this.resources].reverse()) {
      try {
        if (row.kind === 'container') this.stop(row);
        else this.inspect(row);
        this.cleanupChecks.push({ name: row.name, ok: true });
      } catch {
        this.cleanupChecks.push({ name: row.name, ok: false });
      }
    }
    this.save();
    return this.pending === null && this.cleanupChecks.every((row) => row.ok);
  }
}

/** Acquisition identity survives an identical-content lease replacement.
 * @param {import('../qualification/native-isolation-files.mjs').IsolationLeaseOwner} owner
 * @param {string} [path] */
export function claimReleaseLease(owner, path = nativeLeasePath()) {
  claimIsolationLease(path, owner);
  syncDirectory(dirname(path));
  const original = lstatSync(path);
  const recorded = readPrivate(path, 4096);
  assert.equal(recorded.dev, original.dev);
  assert.equal(recorded.ino, original.ino);
  assert.deepEqual(JSON.parse(recorded.bytes.toString('utf8')), owner);
  const identity = { dev: recorded.dev, ino: recorded.ino, sha256: recorded.sha256 };
  return {
    identity,
    release(/** @type {boolean} */ quiescent) {
      const current = lstatSync(path);
      assert.ok(
        current.ino === original.ino && current.dev === original.dev,
        'Acquired lease was substituted',
      );
      releaseIsolationLease(path, owner, quiescent, identity);
      syncDirectory(dirname(path));
      assert.equal(existsSync(path), false);
    },
  };
}

/** Explicit takeover closes only the original acquisition, never a current replacement.
 * @param {import('../qualification/native-isolation-files.mjs').IsolationLeaseOwner} owner
 * @param {{dev:number,ino:number,sha256:string}} identity @param {boolean} quiescent @param {string} [path] */
export function releaseRecordedLease(owner, identity, quiescent, path = nativeLeasePath()) {
  releaseIsolationLease(path, owner, quiescent, identity);
  syncDirectory(dirname(path));
  assert.equal(existsSync(path), false);
}

/** @param {{functional:boolean,inputs:boolean,quiescent:boolean,leaseReleased:boolean}} checks */
export function releaseOutcome(checks) {
  return Object.values(checks).every((ok) => ok === true) ? 'PASS' : 'FAIL';
}
