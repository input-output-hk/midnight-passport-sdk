import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { assertOtherClaimJournalsSettled } from '../../../examples/midnames-local/claim-journal-selection.mts';
import { openClaimDispatch } from '../../../examples/midnames-local/claim-dispatch.mts';

test('a new claim journal refuses another original until the exact claim is confirmed', async () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'passport-claim-journals-')));
  const oldPath = join(parent, 'claim-journal-candidate');
  const selected = join(parent, 'claim-journal-candidate-fresh');
  mkdirSync(oldPath, { mode: 0o700 });
  mkdirSync(selected, { mode: 0o700 });
  try {
    const bytes = Uint8Array.of(1, 2, 3);
    const receipt = {
      networkId: 'undeployed' as const,
      registryAddress: '11'.repeat(32),
      accountAddress: '22'.repeat(32),
      name: 'newname.night',
      ownerCommitment: '33'.repeat(32),
      transaction: {
        identifiers: ['44'.repeat(33)],
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    };
    const old = openClaimDispatch(oldPath);
    old.retain(bytes, receipt);
    await assert.rejects(
      assertOtherClaimJournalsSettled(selected, async () => true),
      /Resolve/,
    );
    await old.dispatch(receipt, { authorize: async () => {}, submit: async () => {} });
    await assert.rejects(
      assertOtherClaimJournalsSettled(selected, async () => false),
      /Resolve/,
    );
    const seen: string[] = [];
    assert.equal(
      await assertOtherClaimJournalsSettled(selected, async (value) => {
        seen.push(value.transaction.sha256);
        return true;
      }),
      1,
    );
    assert.deepEqual(seen, [receipt.transaction.sha256]);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('a balance intent with no prepared original blocks a new journal', async () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'passport-claim-journals-')));
  const oldPath = join(parent, 'claim-journal-candidate');
  const selected = join(parent, 'claim-journal-candidate-fresh');
  mkdirSync(oldPath, { mode: 0o700 });
  mkdirSync(selected, { mode: 0o700 });
  try {
    writeFileSync(join(oldPath, 'claim-prepare-intent.json'), '{}', { mode: 0o600 });
    await assert.rejects(
      assertOtherClaimJournalsSettled(selected, async () => true),
      /Resolve/,
    );
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
