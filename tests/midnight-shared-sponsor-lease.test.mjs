import assert from 'node:assert/strict';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { sharedSponsorLease } from '../scripts/midnight-shared-sponsor-lease.mjs';
import { nativeLeasePath } from '../scripts/qualification/native-lease.mjs';

function fixture() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'passport-shared-sponsor-')));
  chmodSync(home, 0o700);
  const state = join(home, 'state');
  mkdirSync(state, { mode: 0o700 });
  const registry = join(state, 'registry.json');
  return { home, registry, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

test('shared genesis sponsor is exclusively leased and records each released run', () => {
  const f = fixture();
  try {
    assert.equal(sharedSponsorLease('check', f.registry, f.home), 'free');
    assert.equal(sharedSponsorLease('begin', f.registry, f.home), 'active');
    const lease = nativeLeasePath(f.home);
    const receipt = `${f.registry}.sponsor-lease.json`;
    assert.equal(existsSync(lease), true);
    assert.equal(JSON.parse(readFileSync(receipt, 'utf8')).status, 'active');
    assert.throws(() => sharedSponsorLease('check', f.registry, f.home), /occupied/);
    assert.throws(() => sharedSponsorLease('begin', f.registry, f.home), /unresolved/);
    assert.equal(sharedSponsorLease('finish', f.registry, f.home), 'released');
    assert.equal(existsSync(lease), false);
    assert.equal(sharedSponsorLease('check', f.registry, f.home), 'free');
    assert.equal(sharedSponsorLease('begin', f.registry, f.home), 'active');
    const second = JSON.parse(readFileSync(receipt, 'utf8'));
    assert.equal(second.history.length, 1);
    assert.equal(second.history[0].status, 'released');
    assert.notEqual(second.owner.runId, second.history[0].owner.runId);
    assert.equal(sharedSponsorLease('finish', f.registry, f.home), 'released');
  } finally {
    f.cleanup();
  }
});

test('active or substituted native lease is never removed by a shared demo', () => {
  const f = fixture();
  try {
    sharedSponsorLease('begin', f.registry, f.home);
    const lease = nativeLeasePath(f.home);
    writeFileSync(lease, 'substituted');
    assert.throws(() => sharedSponsorLease('finish', f.registry, f.home), /bytes differ/);
    assert.equal(existsSync(lease), true);
    assert.throws(() => sharedSponsorLease('check', f.registry, f.home), /occupied/);
  } finally {
    f.cleanup();
  }
});

test('receipt write failure rolls back the exact lease before wallet startup', () => {
  const f = fixture();
  try {
    const receipt = `${f.registry}.sponsor-lease.json`;
    writeFileSync(`${receipt}.pending-${process.pid}`, 'blocked', { mode: 0o600 });
    assert.throws(() => sharedSponsorLease('begin', f.registry, f.home), /EEXIST/);
    assert.equal(existsSync(nativeLeasePath(f.home)), false);
    assert.equal(existsSync(receipt), false);
  } finally {
    f.cleanup();
  }
});

test('private canonical registry path is required before claiming the wallet', () => {
  const f = fixture();
  try {
    chmodSync(join(f.home, 'state'), 0o755);
    assert.throws(() => sharedSponsorLease('begin', f.registry, f.home));
    assert.equal(existsSync(nativeLeasePath(f.home)), false);
  } finally {
    f.cleanup();
  }
});
