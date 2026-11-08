import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateInstalledCases } from '../scripts/consumer/installed-cases.mjs';
import { planSuite } from '../scripts/qualification/runner.mjs';
function receipt() {
  let n = 0;
  const cases = [];
  for (const arm of ['jubjub-schnorr', 'p256-webauthn'])
    for (const kind of ['call', 'deploy'])
      for (const boundary of ['before-host', 'after-send'])
        cases.push({
          arm,
          kind,
          boundary,
          verdict: 'PASS',
          state: boundary === 'after-send' ? 'done' : 'unknown',
          jobId: (++n).toString(16).padStart(32, '0'),
          identitySha256: 'aa'.repeat(32),
          recoveryEffectAttempts: 0,
          ledgerUnchanged: true,
          resultVisibilityTtlMs: 0,
          submitEntries: boundary === 'before-host' ? 0 : kind === 'call' ? 1 : 2,
          checks: [
            'actual-http',
            'process-sigkill',
            'original-id',
            'repeat-resume',
            'input-conflict',
            'unauthorised-refusal',
            'missing-read-only',
          ],
        });
  return {
    schemaVersion: 1,
    kind: 'installed-host-jobs-synthetic',
    allRequiredPassed: true,
    cases,
    consent: {
      kind: 'synthetic-hosted-consent',
      supportedDescriptorPreserved: true,
      lossyConversionRefused: true,
      noRejectedHostSessions: true,
      secretCalls: 0,
      realProvider: false,
      unsupportedOwnerFlowsRefused: [
        'rotate-encryption-key',
        'withdraw-unshielded',
        'withdraw-shielded',
      ],
    },
    realProvider: false,
    fullLace: false,
    nativeProof: false,
    releaseQualified: false,
  };
}
test('installed acceptance requires eight distinct arm/kind/interruption cases with bounded claims', () => {
  const good = receipt();
  assert.equal(validateInstalledCases(good), good);
  for (const mutate of [
    (/** @type {any} */ v) => v.cases.pop(),
    (/** @type {any} */ v) => (v.cases[1] = v.cases[0]),
    (/** @type {any} */ v) => (v.realProvider = true),
    (/** @type {any} */ v) => (v.consent.secretCalls = 1),
    (/** @type {any} */ v) => v.consent.unsupportedOwnerFlowsRefused.pop(),
    (/** @type {any} */ v) => (v.cases[0].state = 'done'),
    (/** @type {any} */ v) => (v.cases[0].recoveryEffectAttempts = 1),
    (/** @type {any} */ v) => (v.cases[1].submitEntries = 2),
    (/** @type {any} */ v) => v.cases[1].checks.pop(),
    (/** @type {any} */ v) => (v.cases[1].jobId = v.cases[0].jobId),
    (/** @type {any} */ v) => (v.cases[1].identitySha256 = 'unknown'),
  ]) {
    const changed = structuredClone(good);
    mutate(changed);
    assert.throws(() => validateInstalledCases(changed));
  }
});
test('installed consumer remains opt-in, with missing input never satisfying a release gate', () => {
  const [plan] = planSuite('consumer-installed', {});
  assert.ok(plan);
  assert.equal(plan.tier, 'packed-consumer');
  assert.deepEqual(plan.missing, ['CONSUMER_ROOT']);
  assert.ok(!planSuite('release', {}).some((p) => p.id === plan.id));
});

test('receipt envelope and consent refusal precede later field access', () => {
  const envelope = receipt();
  envelope.realProvider = true;
  Object.defineProperty(envelope, 'consent', {
    get() {
      throw new Error('consent must not be read');
    },
  });
  assert.throws(() => validateInstalledCases(envelope), {
    message: 'incomplete or overclaimed installed scenario results',
  });
  const consent = receipt();
  consent.consent.secretCalls = 1;
  const first = consent.cases[0];
  assert.ok(first);
  Object.defineProperty(first, 'verdict', {
    get() {
      throw new Error('cases must not be read');
    },
  });
  assert.throws(() => validateInstalledCases(consent), {
    message: 'missing or overclaimed installed consent boundary',
  });
});

test('case identity and duplicate job checks retain short-circuit order', () => {
  const wrongCase = receipt();
  const first = wrongCase.cases[0];
  assert.ok(first);
  first.arm = 'unknown';
  Object.defineProperty(first, 'verdict', {
    get() {
      throw new Error('invalid case must stop before verdict');
    },
  });
  assert.throws(() => validateInstalledCases(wrongCase), {
    message: 'invalid installed interruption evidence',
  });
  const duplicate = receipt();
  const [one, two] = duplicate.cases;
  assert.ok(one && two);
  two.jobId = one.jobId;
  Object.defineProperty(two, 'checks', {
    get() {
      throw new Error('duplicate must stop before checks');
    },
  });
  assert.throws(() => validateInstalledCases(duplicate), {
    message: 'invalid installed interruption evidence',
  });
});
