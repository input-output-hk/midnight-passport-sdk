import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { publishTimes, packageName } from '../scripts/ci/metadata.mjs';
import { addedVersions, lockVersions, versionPair } from '../scripts/ci/lock-versions.mjs';
import { evaluateCooldown, publishDate } from '../scripts/ci/cooldown.mjs';

const now = Date.parse('2026-11-10T12:00:00.000Z');
const old = '2026-11-03T12:00:00.000Z';
/** @param {string} name @param {unknown} [date] */
const reply = (name, date = old) => Response.json({ name, time: { '1.0.0': date } });
/** @param {string[]} pairs */
const changes = (pairs) => ({
  source: 'a'.repeat(40),
  baseline: 'b'.repeat(40),
  lockfiles: ['pnpm-lock.yaml'],
  added: pairs.map(versionPair),
});

test('noncanonical pnpm mappings cannot silently omit packages', () => {
  for (const body of [
    'packages:\n    example@1.0.0:\n        resolution: {}\n',
    'packages:\n   example@1.0.0:\n     resolution: {}\n',
    'packages: {example@1.0.0: {resolution: {}}}\n',
    'packages:\n  example@1.0.0:\n    resolution: {}\n    hidden@1.0.0:\n      resolution: {}\n',
    'packages:\n  example@1.0.0:\n    resolution: {}\n  example@1.0.0:\n    resolution: {}\n',
    'packages: {}\n  example@1.0.0:\n    resolution: {}\n',
    'packages: {}\npackages: {}\n',
    'packages:\n',
  ])
    assert.throws(() => lockVersions('pnpm-lock.yaml', "lockfileVersion: '9.0'\n" + body));
});

test('npm aliases consult the actual package name and its own publish time', async () => {
  const lock = JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { name: 'consumer' },
      'node_modules/old-alias': { name: 'real-target', version: '1.0.0' },
    },
  });
  const pairs = [...lockVersions('package-lock.json', lock)];
  assert.deepEqual(pairs, ['real-target@1.0.0']);
  /** @type {string[]} */ const requested = [];
  const result = await evaluateCooldown(changes(pairs), '', now, {
    fetcher: async (url) => {
      const name = decodeURIComponent(new URL(String(url)).pathname.slice(1));
      requested.push(name);
      return reply(name, name === 'real-target' ? '2026-11-10T11:00:00Z' : old);
    },
  });
  assert.equal(result.passed, false);
  assert.deepEqual(requested, ['real-target']);
});

for (const variant of [
  'boundary',
  'recent',
  'override',
  'missing',
  'NaN',
  'calendar',
  'future',
  'missing-with-override',
])
  test(`cooldown publish age is complete and fail-closed: ${variant}`, async () => {
    const date = variant.startsWith('missing')
      ? undefined
      : variant === 'NaN'
        ? 'not-a-date'
        : variant === 'calendar'
          ? '2026-02-31T00:00:00Z'
          : variant === 'future'
            ? '2027-01-01T00:00:00Z'
            : ['recent', 'override'].includes(variant)
              ? '2026-11-04T12:00:00Z'
              : old;
    const fetcher = /** @type {typeof fetch} */ (
      async () =>
        date === undefined ? Response.json({ name: 'example', time: {} }) : reply('example', date)
    );
    const body = variant.includes('override')
      ? 'Cooldown-override: urgent reviewed security fix'
      : '';
    const operation = evaluateCooldown(changes(['example@1.0.0']), body, now, { fetcher });
    if (['missing', 'NaN', 'calendar', 'future', 'missing-with-override'].includes(variant))
      await assert.rejects(operation);
    else {
      const result = await operation;
      assert.equal(result.passed, variant !== 'recent');
      assert.equal(result.versions.length, 1);
      assert.equal(result.metadata.calls, 1);
    }
  });

test('metadata deduplicates names and bounds actual active requests', async () => {
  let active = 0,
    maximum = 0,
    calls = 0;
  const fetcher = /** @type {typeof fetch} */ (
    async (url, options) => {
      assert.equal(options?.redirect, 'manual');
      assert.deepEqual(options?.headers, { Accept: 'application/json' });
      assert.match(String(url), /^https:\/\/registry\.npmjs\.org\//);
      active++;
      calls++;
      maximum = Math.max(maximum, active);
      await delay(5);
      active--;
      return reply(decodeURIComponent(new URL(String(url)).pathname.slice(1)));
    }
  );
  const result = await publishTimes(['a', 'b', 'a', '@types/example', 'd', 'e'], {
    fetcher,
    concurrency: 2,
  });
  assert.equal(calls, 5);
  assert.equal(maximum, 2);
  assert.equal(active, 0);
  assert.equal(result.times.size, 5);
});

test('transient responses retry only within the attempt bound', async () => {
  let calls = 0;
  const result = await publishTimes(['example'], {
    fetcher: async () => (++calls === 1 ? new Response(null, { status: 503 }) : reply('example')),
  });
  assert.equal(result.calls, 2);
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(
    publishTimes(['example'], {
      fetcher: async () => {
        calls++;
        return new Response(null, { status: 429 });
      },
    }),
  );
  assert.equal(calls, 2);
});

for (const variant of [
  'redirect',
  'missing-package',
  'foreign-name',
  'foreign-url',
  'wrong-mime',
  'invalid-json',
  'too-large',
  'missing-body',
  'missing-times',
])
  test(`metadata refusal never becomes a safe age: ${variant}`, async () => {
    let calls = 0;
    const fetcher = /** @type {typeof fetch} */ (
      async () => {
        calls++;
        if (variant === 'redirect')
          return new Response(null, {
            status: 302,
            headers: { Location: 'https://foreign.example/' },
          });
        if (variant === 'missing-package') return new Response(null, { status: 404 });
        if (variant === 'foreign-name') return reply('different');
        if (variant === 'wrong-mime') return new Response('{}');
        if (variant === 'invalid-json')
          return new Response('{', { headers: { 'Content-Type': 'application/json' } });
        if (variant === 'missing-body')
          return new Response(null, { headers: { 'Content-Type': 'application/json' } });
        if (variant === 'missing-times') return Response.json({ name: 'example' });
        const response = reply('example');
        if (variant === 'foreign-url')
          Object.defineProperty(response, 'url', { value: 'https://foreign.example/' });
        return response;
      }
    );
    await assert.rejects(
      publishTimes(['example'], { fetcher, maxBytes: variant === 'too-large' ? 8 : 1024 }),
    );
    assert.equal(calls, 1);
  });

test('hung headers and bodies have a bounded overall deadline', async () => {
  for (const body of [false, true]) {
    let calls = 0;
    const fetcher = /** @type {typeof fetch} */ (
      async () => {
        calls++;
        return body
          ? new Response(new ReadableStream({ start() {} }), {
              headers: { 'Content-Type': 'application/json' },
            })
          : new Promise(() => {});
      }
    );
    const started = performance.now();
    await assert.rejects(publishTimes(['example'], { fetcher, overallMs: 40, requestMs: 20 }));
    assert.ok(performance.now() - started < 2_000);
    assert.ok(calls <= 2);
  }
});

test('batch failure cancels sibling metadata calls rather than leaving work running', async () => {
  let cancelled = 0;
  const fetcher = /** @type {typeof fetch} */ (
    async (url, options) => {
      if (String(url).endsWith('/a')) return reply('wrong');
      return new Promise((_, reject) =>
        options?.signal?.addEventListener(
          'abort',
          () => {
            cancelled++;
            reject(Error('cancelled'));
          },
          { once: true },
        ),
      );
    }
  );
  await assert.rejects(publishTimes(['a', 'b', 'c'], { fetcher, concurrency: 3 }));
  assert.equal(cancelled, 2);
});

test('name and exact-version admission refuses registry/protocol ambiguity', () => {
  for (const name of [
    '..',
    '../foreign',
    '@scope/../name',
    'https://foreign',
    'a?token=x',
    'white space',
    'a\n',
  ])
    assert.throws(() => packageName(name));
  for (const pair of [
    'a@git+https://foreign',
    'a@file:../a',
    'a@workspace:*',
    'a@1',
    'a@01.0.0',
    'a@1.0.0-01',
    'a@1.0.0-..',
    'a@latest',
  ])
    assert.throws(() => versionPair(pair));
  assert.equal(versionPair('@scope/name@1.0.0-rc.9+build.1').name, '@scope/name');
});

test('lock parsers retain exact supported entries and refuse malformed formats', () => {
  const yaml =
    "lockfileVersion: '9.0'\npackages:\n  '@scope/name@1.0.0':\n    resolution: {integrity: safe}\n  other@2.0.0(peer@3.0.0):\n    resolution: {}\nsnapshots:\n  ignored@4.0.0: {}\n";
  assert.deepEqual([...lockVersions('pnpm-lock.yaml', yaml)], ['@scope/name@1.0.0', 'other@2.0.0']);
  assert.deepEqual(
    [
      ...lockVersions(
        'package-lock.json',
        JSON.stringify({
          lockfileVersion: 3,
          packages: {
            '': { version: '0.0.0' },
            'node_modules/a': { version: '1.0.0' },
            'node_modules/alias': { link: true },
            'node_modules/a/node_modules/b': { version: '2.0.0' },
          },
        }),
      ),
    ],
    ['a@1.0.0', 'b@2.0.0'],
  );
  for (const bad of [
    yaml.replace('9.0', '8.0'),
    yaml.replace("'@scope/name@1.0.0':", "'@scope/name@latest':"),
    yaml.replace('packages:', 'packages: []'),
    yaml.replace('other@2.0.0(peer@3.0.0):', 'not a package key'),
  ])
    assert.throws(() => lockVersions('pnpm-lock.yaml', bad));
  assert.throws(() => lockVersions('package-lock.json', '{'));
  assert.throws(() => lockVersions('package-lock.json', '{"lockfileVersion":1}'));
  assert.throws(() => publishDate('2026-11-10T12:00:01Z', now, 'a'));
});

test('committed nested lock inventory, missing base and unsupported lockfiles remain explicit', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'passport-cooldown-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (/** @type {string[]} */ args) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        '-c',
        'commit.gpgsign=false',
        '-c',
        'core.hooksPath=/dev/null',
        ...args,
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  git(['init', '-q']);
  writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\npackages: {}\n");
  git(['add', '.']);
  git(['commit', '-qm', 'synthetic empty lock']);
  const base = git(['rev-parse', 'HEAD']).trim();
  mkdirSync(join(root, 'nested'));
  writeFileSync(
    join(root, 'nested/package-lock.json'),
    JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/new': { version: '1.0.0' } } }),
  );
  git(['add', '.']);
  git(['commit', '-qm', 'synthetic nested lock']);
  const result = addedVersions(root, base);
  assert.equal(result.lockfiles.length, 2);
  assert.equal(result.added[0]?.pair, 'new@1.0.0');
  assert.throws(() => addedVersions(root, 'unknown-base'));
  assert.throws(() => addedVersions(root, '--help'));
  const cli = spawnSync(
    process.execPath,
    [join(process.cwd(), 'mn-passport-skills/scripts/check-dep-cooldown.mjs'), 'HEAD'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(cli.status, 0, cli.stderr);
  writeFileSync(join(root, 'nested/yarn.lock'), 'unsupported');
  git(['add', '.']);
  git(['commit', '-qm', 'synthetic unsupported lock']);
  assert.throws(() => addedVersions(root, base), /Unsupported lockfile/);
});
