import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import {
  journeyCatalog,
  journeyGroups,
  expectedCases,
  journeySelection,
} from '../e2e/journeys/catalog.mjs';
const fundingExtensionIds = new Set([
  'account-actions.consecutive-night-deposits-recover-after-wallet-catch-up',
  'account-actions.consecutive-custom-deposits-preserve-asset-and-separate-balances',
  'account-actions.exhausted-availability-checks-recover-in-place-without-a-transfer',
  'account-actions.funding-read-outage-recovers-without-switching-an-insufficient-selection',
  'account-actions.availability-recovery-preserves-the-original-unknown-funding-intent',

  'account-actions.empty-funding-inventory-disables-deposits-without-hiding-withdrawals',
  'account-actions.proved-funding-refusal-is-failed-and-allows-only-explicit-new-intents',
]);
const namesHash = (arm: string) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        expectedCases(arm)
          .filter((c) => !fundingExtensionIds.has(c.id))
          // #304 replaces only JubJub's obsolete strict-probe case with single-call creation.
          // Normalize that documented evolution for historical W9 order verification;
          // the current receipt inventory below must retain the actual new case and name.
          .map((c) =>
            c.id === 'account-actions.jubjub-creation-shares-one-credential-and-routine-keys'
              ? 'the second initial prompt requires separate approval before the compatibility probe'
              : c.name,
          ),
      ),
    )
    .digest('hex');
test('canonical catalog preserves signed W9 full name order and both arm inventories', () => {
  assert.equal(
    namesHash('p256'),
    'c7466fb8309299ce5077e7f683c2e18d3cb8b7fe702c7bcc4a9f75f043d3d48c',
  );
  assert.equal(
    namesHash('jubjub'),
    '7658c576dfa8882fd842d147267c06de58304622e3d4b6f1d3ecdf8d5a218384',
  );
  assert.deepEqual(
    ['p256', 'jubjub'].map((arm) => expectedCases(arm).length),
    [104, 102],
  );
  assert.equal(new Set(journeyCatalog.map((c) => c.id)).size, 105);
  assert.ok(
    expectedCases('jubjub').some(
      (c) => c.id === 'account-actions.jubjub-creation-shares-one-credential-and-routine-keys',
    ),
  );
  assert.ok(
    !expectedCases('jubjub').some(
      (c) => c.id === 'account-actions.the-second-initial-prompt-requires-separate-approval',
    ),
  );
  assert.equal(Object.isFrozen(journeyCatalog), true);
  for (const row of journeyCatalog) {
    assert.equal(Object.isFrozen(row), true);
    assert.equal(Object.isFrozen(row.arms), true);
  }
});
test('four named groups partition the complete arm cases in original order without duplicate credit', () => {
  for (const arm of ['p256', 'jubjub']) {
    const groups = journeyGroups.flatMap((group) => expectedCases(arm, group));
    assert.deepEqual(groups, expectedCases(arm));
    assert.equal(new Set(groups.map((c) => c.id)).size, groups.length);
  }
  assert.deepEqual(
    journeyGroups.map((g) => expectedCases('p256', g).length),
    [16, 55, 16, 17],
  );
  assert.deepEqual(
    journeyGroups.map((g) => expectedCases('jubjub', g).length),
    [16, 54, 16, 16],
  );
});
test('partial or misspelled shard selection cannot silently become a full/default run', () => {
  assert.equal(journeySelection(undefined, undefined), undefined);
  for (const group of journeyGroups) assert.equal(journeySelection('p256', group), group);
  for (const arm of [undefined, '', 'both', 'P256'])
    for (const group of journeyGroups) assert.throws(() => journeySelection(arm, group));
  for (const group of ['', 'all', 'present', 'presentation,owner-safety'])
    assert.throws(() => journeySelection('p256', group));
});
