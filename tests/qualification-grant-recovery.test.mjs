import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatedGrantAccount } from './fixtures/generated-grant-account.mjs';
import { runGrantRecoveryCase } from '../scripts/qualification/grant-recovery-case.mjs';
import { createPassportAccounts } from '../packages/account/dist/index.js';

for (const arm of /** @type {const} */ (['jubjub', 'p256'])) {
  test(`${arm}: generated ACC recovers a fresh reader profile and preserves selective read revocation`, async () => {
    const f = await generatedGrantAccount(arm);
    // A normal directory reload also reconstructs a missing account record, while
    // keeping the original protected grant journal outside the fresh profile.
    const reload = await f.profile('owner', 'directory-reload');
    assert.ok(f.initial.directory);
    await createPassportAccounts({ ...reload, directory: f.initial.directory }).openAccount();
    assert.equal((await reload.records?.read())?.address, f.account);
    const result = await runGrantRecoveryCase(f);
    assert.equal(result.cases.length, 5);
    assert.equal(result.originalJournalConsulted, false);
    assert.equal(result.fullIssueScopeRecovered, false);
    assert.ok(f.effects.includes(`revoke_grant_with_${arm}`));
    assert.ok(f.effects.includes(`revoke_all_grants_with_${arm}`));
  });
}
