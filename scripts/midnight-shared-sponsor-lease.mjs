#!/usr/bin/env node
// Coordinate the shared public genesis sponsor with native qualification lanes.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  claimIsolationLease,
  releaseIsolationLease,
  saveIsolationReceipt,
} from './qualification/native-isolation-files.mjs';
import { nativeLeasePath } from './qualification/native-lease.mjs';

const LEASE_NAME = 'mn-passport-qual-20261023-published-native.lock';
/** @param {string} registry */
function statePath(registry) {
  assert.ok(isAbsolute(registry) && registry.endsWith('.json'));
  const parent = realpathSync(dirname(registry));
  const stat = statSync(parent);
  assert.ok(stat.isDirectory() && (stat.mode & 0o077) === 0);
  if (process.getuid) assert.equal(stat.uid, process.getuid());
  assert.equal(join(parent, basename(registry)), registry, 'Use a canonical registry path.');
  return `${registry}.sponsor-lease.json`;
}

/** @param {string} receiptPath */
function priorReceipt(receiptPath) {
  if (!existsSync(receiptPath)) return undefined;
  const stat = lstatSync(receiptPath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
  assert.equal(stat.mode & 0o077, 0);
  return JSON.parse(readFileSync(receiptPath, 'utf8'));
}

/** @param {'check' | 'begin' | 'finish'} mode @param {string} registry @param {string} [home] */
export function sharedSponsorLease(mode, registry, home = homedir()) {
  const receiptPath = statePath(registry);
  const lease = join(home, '.midnight-passport-native-qualification', LEASE_NAME);
  const previous = priorReceipt(receiptPath);
  if (mode === 'check') {
    assert.ok(
      !existsSync(lease),
      'Native sponsor lease is occupied; reconcile it before shared demo startup.',
    );
    assert.ok(!previous || previous.status === 'released', 'Shared sponsor receipt is unresolved.');
    return 'free';
  }
  if (mode === 'begin') {
    assert.ok(!previous || previous.status === 'released', 'Shared sponsor receipt is unresolved.');
    const path = nativeLeasePath(home);
    assert.equal(path, lease);
    const owner = {
      runId: randomBytes(8).toString('hex'),
      pid: process.ppid,
      project: 'shared-ledger9',
      root: dirname(registry),
    };
    claimIsolationLease(path, owner); // exclusive; never delete an occupied lease
    const stat = lstatSync(path);
    const pin = {
      dev: stat.dev,
      ino: stat.ino,
      sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    };
    const history = previous
      ? [
          ...(previous.history ?? []),
          {
            owner: previous.owner,
            pin: previous.pin,
            status: previous.status,
          },
        ]
      : [];
    try {
      saveIsolationReceipt(receiptPath, { owner, pin, status: 'active', history });
    } catch (error) {
      // No caller can start the wallet until begin succeeds. If no active
      // receipt was published, undo only this exact lease; keep an ambiguous
      // published receipt and its lease for manual reconciliation.
      if (!existsSync(receiptPath)) releaseIsolationLease(path, owner, true, pin);
      throw error;
    }
    return 'active';
  }
  assert.equal(mode, 'finish');
  const receipt = previous;
  assert.ok(receipt, 'No shared sponsor receipt exists.');
  assert.equal(receipt.status, 'active');
  assert.equal(
    receipt.owner.pid,
    process.ppid,
    'Only the originating launcher can release the sponsor.',
  );
  assert.equal(receipt.owner.project, 'shared-ledger9');
  assert.equal(receipt.owner.root, dirname(registry));
  releaseIsolationLease(lease, receipt.owner, true, receipt.pin);
  saveIsolationReceipt(receiptPath, { ...receipt, status: 'released' });
  return 'released';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [flag, registry] = process.argv.slice(2);
    const mode =
      flag === '--check'
        ? 'check'
        : flag === '--begin'
          ? 'begin'
          : flag === '--finish'
            ? 'finish'
            : undefined;
    assert.ok(mode && registry, 'Expected --check, --begin or --finish <registry-path>.');
    console.log(`midnight-shared-sponsor-lease: ${sharedSponsorLease(mode, registry)}`);
  } catch (error) {
    console.error(
      `midnight-shared-sponsor-lease: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
