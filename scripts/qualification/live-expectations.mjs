import assert from 'node:assert/strict';

/** Explicit entrypoint selection; an ambient shell profile never changes a scenario.
 * @param {'baseline'|'combined'|'lifecycle'|'wallet'|'removed-recheck'|'grants'} [profile]
 */
export function liveProfileOptions(profile = 'baseline') {
  assert.ok(
    ['baseline', 'combined', 'lifecycle', 'wallet', 'removed-recheck', 'grants'].includes(profile),
  );
  const removedOnly = profile === 'removed-recheck';
  const grantRecovery = profile === 'grants';
  const lifecycle = profile === 'lifecycle' || removedOnly || grantRecovery;
  return {
    profile,
    lifecycle,
    removedOnly,
    grantRecovery,
    walletOnly: profile === 'wallet',
    combined: lifecycle || profile === 'combined',
  };
}
/** @param {{code:number|null,messages:Array<{failed?:string,code?:string,audit?:{unresolvedEffects?:number}}>}} result @param {string} operation @param {string} fault */
export function requireExpectedFailure(result, operation, fault) {
  const code =
    fault === 'assert-unknown' || fault === 'before-deploy-proof'
      ? 'MutationUnsettled'
      : 'InternalError';
  assert.equal(result.code, 2);
  const failure = result.messages.find((m) => m.failed === operation);
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
