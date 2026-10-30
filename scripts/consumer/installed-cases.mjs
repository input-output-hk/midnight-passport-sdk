// Refuse partial, duplicated or overclaimed synthetic evidence before a qualification pass.
/** @param {unknown} value */
export function validateInstalledCases(value) {
  const v = /** @type {Record<string,any>} */ (value);
  if (
    !v ||
    v.schemaVersion !== 1 ||
    v.kind !== 'installed-host-jobs-synthetic' ||
    v.allRequiredPassed !== true ||
    !Array.isArray(v.cases) ||
    v.cases.length !== 8 ||
    ['realProvider', 'fullLace', 'nativeProof', 'releaseQualified'].some((k) => v[k] !== false)
  )
    throw Error('incomplete or overclaimed installed scenario results');
  if (
    v.consent?.kind !== 'synthetic-hosted-consent' ||
    v.consent.supportedDescriptorPreserved !== true ||
    v.consent.lossyConversionRefused !== true ||
    v.consent.noRejectedHostSessions !== true ||
    v.consent.secretCalls !== 0 ||
    v.consent.realProvider !== false ||
    JSON.stringify(v.consent.unsupportedOwnerFlowsRefused) !==
      JSON.stringify(['rotate-encryption-key', 'withdraw-unshielded', 'withdraw-shielded'])
  )
    throw Error('missing or overclaimed installed consent boundary');
  const expected = new Set();
  for (const arm of ['jubjub-schnorr', 'p256-webauthn'])
    for (const kind of ['call', 'deploy'])
      for (const boundary of ['before-host', 'after-send'])
        expected.add([arm, kind, boundary].join(':'));
  const ids = new Set();
  for (const c of v.cases) {
    if (
      !c ||
      !expected.delete([c.arm, c.kind, c.boundary].join(':')) ||
      c.verdict !== 'PASS' ||
      c.state !== (c.boundary === 'after-send' ? 'done' : 'unknown') ||
      c.recoveryEffectAttempts !== 0 ||
      c.ledgerUnchanged !== true ||
      c.resultVisibilityTtlMs !== 0 ||
      c.submitEntries !== (c.boundary === 'before-host' ? 0 : c.kind === 'deploy' ? 2 : 1) ||
      !/^[a-f0-9]{32}$/.test(c.jobId) ||
      !/^[a-f0-9]{64}$/.test(c.identitySha256) ||
      ids.has(c.jobId) ||
      !Array.isArray(c.checks) ||
      [
        'actual-http',
        'process-sigkill',
        'original-id',
        'repeat-resume',
        'input-conflict',
        'unauthorised-refusal',
        'missing-read-only',
      ].some((k) => !c.checks.includes(k))
    )
      throw Error('invalid installed interruption evidence');
    ids.add(c.jobId);
  }
  if (expected.size) throw Error('missing installed interruption case');
  return v;
}
