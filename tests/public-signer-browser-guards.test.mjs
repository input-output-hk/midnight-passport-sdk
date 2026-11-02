import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  browserOutput,
  browserDeadline,
  browserCleanup,
  browserRuntimeIdentity,
} from '../scripts/qualify-public-signer-browser.mjs';

test('browser fixture refuses existing or escaping roots without replacing retained evidence', () => {
  const consumer = mkdtempSync(join(tmpdir(), 'passport-browser-guards-'));
  try {
    const output = join(consumer, 'signer-browser-new');
    assert.equal(browserOutput(output, consumer), output);
    mkdirSync(output);
    for (const path of [
      output,
      join(consumer, '../signer-browser-outside'),
      join(consumer, 'other'),
      'relative',
    ]) {
      assert.throws(() => browserOutput(path, consumer));
    }
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
});
test('browser action deadline rejects stalled work and preserves original errors', async () => {
  assert.equal(await browserDeadline(async () => 7, 100), 7);
  const failure = Error('original');
  await assert.rejects(
    browserDeadline(async () => {
      throw failure;
    }, 100),
    failure,
  );
  await assert.rejects(
    browserDeadline(() => new Promise(() => {}), 5),
    /deadline exceeded/,
  );
});

test('cleanup attempts all owned resources and records rejection or deadline without raw errors', async () => {
  /** @type {string[]} */ const visited = [];
  const report = await browserCleanup(
    [
      {
        name: 'reject',
        close: async () => {
          visited.push('reject');
          throw Error('private failure');
        },
      },
      {
        name: 'hang',
        close: () => {
          visited.push('hang');
          return new Promise(() => {});
        },
      },
      {
        name: 'last',
        close: async () => {
          visited.push('last');
        },
      },
    ],
    5,
  );
  assert.deepEqual(visited, ['reject', 'hang', 'last']);
  assert.deepEqual(
    report.map((r) => r.closed),
    [false, false, true],
  );
  assert.ok(!JSON.stringify(report).includes('private failure'));
});
test('qualification interrupt rejects active waits and refuses work if already interrupted', async () => {
  const abort = new AbortController();
  const pending = browserDeadline(() => new Promise(() => {}), 1000, abort.signal);
  abort.abort();
  await assert.rejects(pending, /interrupted/);
  let called = false;
  await assert.rejects(
    browserDeadline(
      async () => {
        called = true;
      },
      1000,
      abort.signal,
    ),
    /interrupted/,
  );
  assert.equal(called, false);
});
test('browser runtime identity binds resources and contained links, refusing an escaped framework', () => {
  const root = mkdtempSync(join(tmpdir(), 'passport-browser-runtime-'));
  try {
    writeFileSync(join(root, 'framework'), 'runtime-v1');
    symlinkSync('framework', join(root, 'launcher'));
    const first = browserRuntimeIdentity(root);
    assert.equal(first.links, 1);
    writeFileSync(join(root, 'framework'), 'runtime-v2');
    assert.notDeepEqual(browserRuntimeIdentity(root), first);
    symlinkSync(tmpdir(), join(root, 'escape'));
    assert.throws(() => browserRuntimeIdentity(root), /escapes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('late browser acquisition is closed after settlement without claiming absent resources closed', async () => {
  const { BrowserOwnership } = await import('../scripts/qualification/browser-ownership.mjs');
  const owner = new BrowserOwnership(['late', 'absent']);
  /** @type {((value:unknown)=>void)|undefined} */ let release;
  let closed = 0;
  const acquisition = owner.acquire(
    'late',
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
    async () => {
      closed++;
    },
  );
  const refused = assert.rejects(acquisition, /settled/);
  const report = await owner.cleanup(20);
  assert.deepEqual(
    report.map((r) => [r.status, r.closed]),
    [
      ['pending', false],
      ['not-created', null],
    ],
  );
  assert.throws(() => owner.guard(), /settled/);
  assert.ok(release);
  release('resource');
  await refused;
  assert.equal(closed, 1);
  const final = await owner.cleanup();
  assert.deepEqual(
    final.map((r) => [r.status, r.closed]),
    [
      ['closed', true],
      ['not-created', null],
    ],
  );
});
