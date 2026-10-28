import assert from 'node:assert/strict';

/** Explicit entrypoint selection; an ambient shell profile never changes a scenario.
 * @param {'baseline'|'combined'|'lifecycle'|'wallet'|'removed-recheck'|'grants'|'grants-jubjub'|'grants-p256'|'survivor-outages'|'survivor-outages-jubjub'|'survivor-outages-p256'} [profile]
 * @returns {{profile:string,lifecycle:boolean,removedOnly:boolean,grantRecovery:boolean,survivorOutages:boolean,walletOnly:boolean,combined:boolean,arms:Array<'jubjub'|'p256'>,populateTimeoutMs:number}}
 */
export function liveProfileOptions(profile = 'baseline') {
  assert.ok(
    [
      'baseline',
      'combined',
      'lifecycle',
      'wallet',
      'removed-recheck',
      'grants',
      'grants-jubjub',
      'grants-p256',
      'survivor-outages',
      'survivor-outages-jubjub',
      'survivor-outages-p256',
    ].includes(profile),
  );
  const removedOnly = profile === 'removed-recheck';
  const grantRecovery = ['grants', 'grants-jubjub', 'grants-p256'].includes(profile);
  const survivorOutages = [
    'survivor-outages',
    'survivor-outages-jubjub',
    'survivor-outages-p256',
  ].includes(profile);
  const lifecycle = profile === 'lifecycle' || removedOnly || grantRecovery || survivorOutages;
  return {
    profile,
    lifecycle,
    removedOnly,
    grantRecovery,
    survivorOutages,
    walletOnly: profile === 'wallet',
    combined: lifecycle || profile === 'combined',
    arms:
      profile === 'wallet'
        ? []
        : ['grants-jubjub', 'survivor-outages-jubjub'].includes(profile)
          ? ['jubjub']
          : ['grants-p256', 'survivor-outages-p256'].includes(profile)
            ? ['p256']
            : ['jubjub', 'p256'],
    // Two read-grant issues include preserving rotations and sealed publications.
    // The old single-grant fifteen-minute budget timed out real P-256 setup.
    populateTimeoutMs: (grantRecovery ? 30 : 15) * 60000,
  };
}
/** @param {{code:number|null,messages:Array<{failed?:string,completed?:string,code?:string,audit?:{unresolvedEffects?:number}}>}} result @param {string} operation @param {string} fault @param {'jubjub'|'p256'} arm */
export function requireExpectedFailure(result, operation, fault, arm) {
  assert.ok(['jubjub', 'p256'].includes(arm), 'Require the declared crypto arm.');
  const known =
    (operation === 'create' &&
      ['before-deploy-proof', 'deploy:0:after-submit', 'call:0:after-submit'].includes(fault)) ||
    (operation === 'rotate-prover' && ['before-owner-proof', 'assert-unknown'].includes(fault)) ||
    (['rotate', 'survivor-rotate'].includes(operation) &&
      (fault === 'call:0:after-submit' ||
        fault === `circuit:rotate_enc_key_with_${arm}:after-submit`)) ||
    (operation === 'add-target' && fault === `circuit:add_device_with_${arm}:after-submit`) ||
    (operation === 'remove-target' && fault === `circuit:rotate_enc_key_with_${arm}:after-submit`);
  assert.ok(known, 'Unknown operation/fault must not qualify through a fallback error code.');
  const code =
    fault === 'assert-unknown' ||
    fault === 'before-deploy-proof' ||
    fault === 'deploy:0:after-submit'
      ? 'MutationUnsettled'
      : 'InternalError';
  assert.equal(result.code, 2);
  const failures = result.messages.filter((m) => m.failed !== undefined);
  assert.equal(failures.length, 1);
  const failure = failures[0];
  assert.equal(failure?.failed, operation);
  assert.equal(
    result.messages.some((m) => m.completed === operation),
    false,
  );
  assert.equal(
    failure?.code,
    code,
    'Require the expected SDK/transport failure, not an arbitrary exception.',
  );
  assert.equal(failure?.audit?.unresolvedEffects, 1);
}
/** Match only the keyring's specific no-current-envelope refusal, never malformed input/network errors.
 * @param {()=>Promise<unknown>} work */
export async function requireNoCurrentKey(work) {
  await assert.rejects(work, {
    message: 'EncryptionKeyMismatch: no envelope opens the ledger enc_key',
  });
}
export const WALLET_WINDOWS = Object.freeze({
  approvalMs: 90000,
  ttlMs: 180000,
  submitMs: 60000,
  dispatchMarginMs: 10000,
});

/** Require the complete native grant case and arm-specific circuit inventory.
 * @param {any} result @param {string} arm */
export function requireGrantRecoverySummary(result, arm) {
  assert.ok(['jubjub', 'p256'].includes(arm));
  assert.deepEqual(result?.cases, [
    {
      name: 'original-reader-reconstruction',
      reconstructed: 2,
      independentReaderRefused: true,
      recoveredFullIssueScope: false,
    },
    { name: 'opening-preflight-refusals', preservedActiveTargets: 2, noTransportEffects: true },
    {
      name: 'recovered-reader-rotation',
      activeReadGrants: 2,
      ownerAndSurvivorRetained: true,
      heldCoinsQualified: 1,
    },
    {
      name: 'selective-read-revocation',
      revoked: 1,
      survivingReadGrants: 1,
      revokedOpeningRefused: true,
      heldCoinsQualified: 1,
    },
    {
      name: 'all-read-revocation',
      activeGrants: 0,
      generationAdvanced: true,
      ownerAndSurvivorRetained: true,
      heldCoinsQualified: 1,
    },
  ]);
  assert.equal(result.completed, 'grant-recovery');
  assert.equal(result.profiles, 4);
  assert.ok(Number.isSafeInteger(result.freshProfileWrites) && result.freshProfileWrites > 0);
  assert.ok(Number.isSafeInteger(result.nativeCalls) && result.nativeCalls > 0);
  assert.equal(result.confirmedCircuits?.length, result.nativeCalls);
  assert.deepEqual(
    result.confirmedCircuits,
    [
      ...Array(4).fill('append_inbox'),
      'rotate_enc_key',
      ...Array(4).fill('append_inbox'),
      'rotate_enc_key',
      'append_inbox',
      'revoke_grant',
      ...Array(2).fill('append_inbox'),
      'rotate_enc_key',
      'append_inbox',
      'revoke_all_grants',
    ].map((name) => `${name}_with_${arm}`),
  );
  assert.equal(result.forbiddenJournalTouches, 0);
  assert.equal(result.protectedProfileUnchanged, true);
  assert.equal(result.refusalChecksIncludeProfileWrites, true);
  assert.equal(result.heldCoinsQualified, 1);
  for (const key of [
    'originalJournalConsulted',
    'fullIssueScopeRecovered',
    'privateGranteeKeysRecovered',
    'nativeGrantContinuationQualified',
  ])
    assert.equal(result[key], false);
}

/** Exactly one completion; conflicting or duplicate summaries cannot be hidden.
 * @param {any[]} messages @param {string} arm */
export function requireGrantRecoveryCompletion(messages, arm) {
  const completed = messages.filter((m) => m.completed === 'grant-recovery');
  assert.equal(completed.length, 1);
  requireGrantRecoverySummary(completed[0], arm);
}

/** Require the injected boundary, not an unrelated process exit.
 * @param {{code:number|null,messages:Array<{crash?:string}>}} result @param {string} fault */
export function requireExpectedHostCrash(result, fault) {
  assert.equal(result.code, 86);
  const crashes = result.messages.filter((m) => m.crash !== undefined);
  assert.equal(crashes.length, 1);
  assert.equal(crashes[0]?.crash, fault);
}
