import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFundingBinding } from '../src/binding.ts';

test('candidate funding refuses a swapped generated module before executing it', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'passport-funding-binding-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'contract'));
  writeFileSync(join(root, 'contract/index.js'), 'throw Error("must not run")');
  await assert.rejects(
    loadFundingBinding({
      bindingId: 'acc-s3r1.1-zkir036',
      contractDir: root,
      artefactDir: root,
      provisionalLocal: true,
    }),
    /differs from the package pin/,
  );
});
