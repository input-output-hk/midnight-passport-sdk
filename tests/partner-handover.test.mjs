import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  admitHandoverPath,
  inspectHandoverTree,
  scanHandoverText,
  checkPartnerHandover,
} from '../scripts/docs/check-handover.mjs';

test('handover names refuse private/process roots, traversal, environment files and platform absolute paths', () => {
  for (const path of [
    'docs/site/api.md',
    'dist/authorisation.js',
    'assets/passport.svg',
    'qualification/index.html',
  ])
    assert.doesNotThrow(() => admitHandoverPath(path));
  for (const path of [
    '../outside',
    '/tmp/outside',
    'C:/Users/person/file',
    'docs\\api.md',
    'AGENTS.md',
    'docs/review/run.md',
    'apps/service/qualification/live.ts',
    '.env',
    'dist/.env.local',
    'docs//site',
    'docs/./site',
    '.git/config',
    'CLAUDE.md',
  ])
    assert.throws(() => admitHandoverPath(path), /Unapproved/);
});

test('handover text admits SDK security documentation but refuses machine/vault/tool-process details without echoing content', () => {
  for (const text of [
    'Never persist raw PRF or owner keys.',
    'Passkey providers can reject an operation.',
    'The host supplies a private secret store.',
  ])
    assert.doesNotThrow(() => scanHandoverText('api.md', Buffer.from(text)));
  for (const text of [
    '/Users/private-person/obsidian/private.md',
    '/home/private-person/private.md',
    'C:\\Users\\private-person\\vault',
    'Initiatives/07 Midnight Passport ACC/SDK milestones/',
    'when Claude is quota-limited',
    '.mn-passport-skills/private.json',
  ]) {
    assert.throws(
      () => scanHandoverText('api.md', Buffer.from(text)),
      (error) =>
        error instanceof Error &&
        error.message === 'Private process detail in handover content: api.md',
    );
  }
});

test('handover tree records exact bytes and refuses empty, oversized, linked and contaminated exports', () => {
  const root = mkdtempSync(join(tmpdir(), 'passport-handover-'));
  try {
    const extensions = new Set(['.md']);
    assert.throws(() => inspectHandoverTree(root, 'docs', extensions, 100), /Empty/);
    writeFileSync(join(root, 'api.md'), 'public contract');
    const accepted = inspectHandoverTree(root, 'docs', extensions, 100);
    assert.equal(accepted[0]?.bytes, 15);
    assert.equal(accepted[0]?.path, 'docs/api.md');
    assert.match(accepted[0]?.sha256 ?? '', /^[a-f0-9]{64}$/);
    assert.throws(() => inspectHandoverTree(root, 'docs', extensions, 2), /Unsupported/);
    assert.throws(() => inspectHandoverTree(root, 'docs', extensions, Infinity), /Invalid/);
    symlinkSync(join(root, 'api.md'), join(root, 'other.md'));
    assert.throws(() => inspectHandoverTree(root, 'docs', extensions, 100), /symlink/);
    rmSync(join(root, 'other.md'));
    mkdirSync(join(root, 'review'));
    assert.throws(() => inspectHandoverTree(root, 'docs', extensions, 100), /Unapproved/);
    rmSync(join(root, 'review'), { recursive: true });
    writeFileSync(join(root, 'api.md'), '/Users/private-person/internal');
    assert.throws(() => inspectHandoverTree(root, 'docs', extensions, 100), /Private process/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('source allowlist and rendered content are checked independently; journals are not selected by the export plan', () => {
  const root = mkdtempSync(join(tmpdir(), 'passport-handover-policy-'));
  try {
    mkdirSync(join(root, 'docs/site'), { recursive: true });
    mkdirSync(join(root, 'docs/review'), { recursive: true });
    mkdirSync(join(root, 'rendered'), { recursive: true });
    const policy = {
      schemaVersion: 1,
      sourceRoots: ['docs/site'],
      excludedRoots: ['docs/review'],
      textExtensions: ['.md', '.html'],
      maximumFileBytes: 1000,
    };
    writeFileSync(join(root, 'docs/partner-handover-policy.json'), JSON.stringify(policy));
    writeFileSync(join(root, 'docs/site/api.md'), 'public API');
    writeFileSync(join(root, 'docs/review/private.md'), '/Users/private-person/journal');
    writeFileSync(join(root, 'rendered/index.html'), '<p>public API</p>');
    const result = checkPartnerHandover({ repository: root, rendered: join(root, 'rendered') });
    assert.equal(result.files.length, 2);
    assert.equal(result.outcome, 'passed');
    writeFileSync(join(root, 'rendered/index.html'), '<p>/Users/private-person/leak</p>');
    assert.throws(
      () => checkPartnerHandover({ repository: root, rendered: join(root, 'rendered') }),
      /Private process/,
    );
    policy.sourceRoots = ['docs/review'];
    writeFileSync(join(root, 'docs/partner-handover-policy.json'), JSON.stringify(policy));
    assert.throws(() => checkPartnerHandover({ repository: root }), /Unapproved|excluded/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
