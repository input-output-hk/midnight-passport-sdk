import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatedGrantAccount } from './fixtures/generated-grant-account.mjs';
import { runGrantRecoveryCase } from '../scripts/qualification/grant-recovery-case.mjs';
import { createPassportAccounts } from '../packages/account/dist/index.js';

for (const arm of /** @type {const} */ (['jubjub', 'p256'])) {
  test(`${arm}: generated ACC recovers a fresh reader profile and preserves selective read revocation`, async () => {
    const f = await generatedGrantAccount(arm);
    if (arm === 'jubjub') {
      // A matching SDK refusal must still fail qualification if it wrote even an
      // identical local record. The probe leaves the generated ACC untouched.
      await assert.rejects(
        runGrantRecoveryCase({
          ...f,
          profile: async (role, name) => {
            const ports = await f.profile(role, `audit-probe-${name}`);
            if (role !== 'survivor') return ports;
            assert.ok(ports.viewingKey && ports.records);
            const viewingKey = ports.viewingKey,
              records = ports.records;
            return {
              ...ports,
              viewingKey: {
                ...viewingKey,
                openInbox: async (...args) => {
                  const result = await viewingKey.openInbox(...args);
                  const record = await records.read();
                  if (record) await records.write(record);
                  return result;
                },
              },
            };
          },
        }),
        { code: 'ERR_ASSERTION', message: /^Refusal must precede every effect attempt\./ },
      );
      await f.assertRetained();
    }
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
