import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { manifestStatus, parseArgs } from '../scripts/demo.mjs';

test('demo CLI chooses up by default and parses explicit setup options', () => {
  assert.deepEqual(parseArgs([]), {
    command: 'up',
    keyService: true,
    open: false,
    mockPasskey: false,
  });
  const args = ['setup', '--passport-repo', '.', '--no-key-service'];
  const parsed = parseArgs(args);
  assert.equal(parsed.command, 'setup');
  assert.equal(parsed.passportRepo, process.cwd());
  assert.equal(parsed.keyService, false);
  assert.deepEqual(args, ['setup', '--passport-repo', '.', '--no-key-service']);
  assert.throws(() => parseArgs(['up', '--contract-dir']), /needs a directory/);
  assert.equal(parseArgs(['-h']).help, true);
  assert.throws(() => parseArgs(['reset']), /unknown command/);
});

test('demo setup rejects an ACC manifest that differs from its release binding', () => {
  const contract = mkdtempSync(join(tmpdir(), 'passport-demo-cli-'));
  try {
    const compiler = join(contract, 'contracts/managed/account/compiler');
    assert.equal(manifestStatus(contract), 'missing');
    mkdirSync(compiler, { recursive: true });
    const manifest = '{}';
    writeFileSync(join(compiler, 'contract-manifest.json'), manifest);
    assert.throws(
      () => manifestStatus(contract),
      new RegExp(createHash('sha256').update(manifest).digest('hex')),
    );
  } finally {
    rmSync(contract, { recursive: true, force: true });
  }
});
