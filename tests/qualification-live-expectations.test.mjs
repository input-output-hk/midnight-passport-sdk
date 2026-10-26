import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  liveProfileOptions,
  requireExpectedFailure,
  requireExpectedHostCrash,
  requireNoCurrentKey,
  WALLET_WINDOWS,
  requireGrantRecoverySummary,
  requireGrantRecoveryCompletion,
} from '../scripts/qualification/live-expectations.mjs';
import {
  createSoftwareIdentity,
  softwareParticipant,
} from '../scripts/qualification/identities.mjs';

test('baseline selection cannot be replaced by an ambient wallet profile', () => {
  const before = process.env.PASSPORT_LIVE_PROFILE;
  try {
    process.env.PASSPORT_LIVE_PROFILE = 'wallet';
    assert.equal(liveProfileOptions().profile, 'baseline');
    assert.equal(liveProfileOptions().walletOnly, false);
    assert.equal(liveProfileOptions('combined').combined, true);
    assert.equal(liveProfileOptions('lifecycle').lifecycle, true);
    assert.equal(liveProfileOptions('wallet').walletOnly, true);
    assert.equal(liveProfileOptions('grants').grantRecovery, true);
    assert.equal(liveProfileOptions('grants').walletOnly, false);
    assert.deepEqual(liveProfileOptions('grants').arms, ['jubjub', 'p256']);
    assert.deepEqual(liveProfileOptions('grants-jubjub').arms, ['jubjub']);
    assert.deepEqual(liveProfileOptions('grants-p256').arms, ['p256']);
    assert.equal(liveProfileOptions('grants-p256').populateTimeoutMs, 30 * 60000);
    assert.equal(liveProfileOptions('combined').populateTimeoutMs, 15 * 60000);
  } finally {
    if (before === undefined) delete process.env.PASSPORT_LIVE_PROFILE;
    else process.env.PASSPORT_LIVE_PROFILE = before;
  }
});

test('unknown-send qualification refuses arbitrary errors even with a pending audit', () => {
  const result = {
    code: 2,
    messages: [
      { failed: 'rotate-prover', code: 'MutationUnsettled', audit: { unresolvedEffects: 1 } },
    ],
  };
  requireExpectedFailure(result, 'rotate-prover', 'assert-unknown');
  assert.throws(() =>
    requireExpectedFailure(
      { ...result, messages: [{ ...result.messages[0], code: 'InternalError' }] },
      'rotate-prover',
      'assert-unknown',
    ),
  );
  assert.throws(() => requireExpectedFailure(result, 'different-operation', 'assert-unknown'));
});

test('no-current-key evidence requires the specific cryptographic refusal and a real usable positive ring', async () => {
  const original = softwareParticipant(await createSoftwareIdentity(), 'jubjub');
  const outsider = softwareParticipant(await createSoftwareIdentity(), 'jubjub');
  const reader = await original.reader();
  const keys = await original.keyring.createKeys('undeployed', {
    devicePublicKey: reader.devicePublicKey,
  });
  const ring = { account: 'ab'.repeat(32), encKey: keys.encKey, envelopes: keys.envelopes };
  await original.keyring.openInbox('undeployed', ring, keys.envelopes);
  await requireNoCurrentKey(() => outsider.keyring.openInbox('undeployed', ring, keys.envelopes));
  await assert.rejects(
    requireNoCurrentKey(() => original.keyring.openInbox('undeployed', ring, keys.envelopes)),
  );
  await assert.rejects(
    requireNoCurrentKey(() =>
      outsider.keyring.openInbox(
        'undeployed',
        { ...ring, encKey: new Uint8Array(1) },
        keys.envelopes,
      ),
    ),
  );
  await assert.rejects(
    requireNoCurrentKey(async () => {
      throw new TypeError('unrelated failure');
    }),
  );
});

test('wallet approval and submission budgets leave margin inside the original TTL', () => {
  assert.ok(WALLET_WINDOWS.approvalMs > 30000 + 10000 + 15000);
  assert.ok(
    WALLET_WINDOWS.ttlMs >
      WALLET_WINDOWS.approvalMs + WALLET_WINDOWS.submitMs + WALLET_WINDOWS.dispatchMarginMs,
  );
});

test('native grant summaries require exact cases, positive writes and the arm-specific circuit inventory', () => {
  for (const arm of ['jubjub', 'p256']) {
    const result = {
      completed: 'grant-recovery',
      profiles: 4,
      freshProfileWrites: 4,
      nativeCalls: 17,
      cases: [
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
      ],
      confirmedCircuits: [
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
      forbiddenJournalTouches: 0,
      protectedProfileUnchanged: true,
      refusalChecksIncludeProfileWrites: true,
      heldCoinsQualified: 1,
      originalJournalConsulted: false,
      fullIssueScopeRecovered: false,
      privateGranteeKeysRecovered: false,
      nativeGrantContinuationQualified: false,
    };
    requireGrantRecoverySummary(result, arm);
    requireGrantRecoveryCompletion([{ ready: true }, result], arm);
    assert.throws(() => requireGrantRecoveryCompletion([], arm));
    assert.throws(() => requireGrantRecoveryCompletion([result, { ...result }], arm));
    for (const change of [
      { cases: result.cases.map((c, i) => (i === 3 ? result.cases[0] : c)) },
      { freshProfileWrites: 0 },
      { nativeCalls: 18 },
      {
        nativeCalls: 18,
        confirmedCircuits: [...result.confirmedCircuits, `append_inbox_with_${arm}`],
      },
      { nativeCalls: 16, confirmedCircuits: result.confirmedCircuits.slice(1) },
      { confirmedCircuits: [...result.confirmedCircuits].reverse() },
      {
        confirmedCircuits: result.confirmedCircuits.map((c, i) =>
          i === 4 ? `append_inbox_with_${arm}` : c,
        ),
      },
      {
        confirmedCircuits: result.confirmedCircuits.map((c) =>
          c.includes('revoke_all') ? `revoke_grant_with_${arm}` : c,
        ),
      },
      { originalJournalConsulted: true },
      { protectedProfileUnchanged: false },
    ])
      assert.throws(() => requireGrantRecoverySummary({ ...result, ...change }, arm));
    assert.throws(() => requireGrantRecoverySummary(result, arm === 'p256' ? 'jubjub' : 'p256'));
  }
});

test('current native fault classification is closed and refuses wrong/duplicate success or failure summaries', () => {
  /** @type {Array<[string,string,string]>} */ const cases = [
    ['create', 'before-deploy-proof', 'MutationUnsettled'],
    ['create', 'deploy:0:after-submit', 'MutationUnsettled'],
    ['create', 'call:0:after-submit', 'InternalError'],
    ['rotate', 'call:0:after-submit', 'InternalError'],
    ['survivor-rotate', 'call:0:after-submit', 'InternalError'],
    ['rotate-prover', 'before-owner-proof', 'InternalError'],
    ['rotate-prover', 'assert-unknown', 'MutationUnsettled'],
  ];
  for (const arm of ['p256', 'jubjub'])
    cases.push(
      ['add-target', `circuit:add_device_with_${arm}:after-submit`, 'InternalError'],
      ['remove-target', `circuit:rotate_enc_key_with_${arm}:after-submit`, 'InternalError'],
    );
  for (const [operation, fault, code] of cases) {
    const message = { failed: operation, code, audit: { unresolvedEffects: 1 } };
    const result = { code: 2, messages: [message] };
    requireExpectedFailure(result, operation, fault);
    for (const change of [
      { code: 0 },
      { messages: [{ ...message, code: 'Error' }] },
      {
        messages: [
          {
            ...message,
            code: code === 'MutationUnsettled' ? 'InternalError' : 'MutationUnsettled',
          },
        ],
      },
      { messages: [{ ...message, audit: { unresolvedEffects: 0 } }] },
      { messages: [message, message] },
      { messages: [message, { completed: operation }] },
    ])
      assert.throws(() => requireExpectedFailure({ ...result, ...change }, operation, fault));
  }
  assert.throws(() =>
    requireExpectedFailure(
      {
        code: 2,
        messages: [{ failed: 'rotate', code: 'InternalError', audit: { unresolvedEffects: 1 } }],
      },
      'rotate',
      'unregistered-fault',
    ),
  );
  for (const [profile, arms] of [
    ['survivor-outages', ['jubjub', 'p256']],
    ['survivor-outages-jubjub', ['jubjub']],
    ['survivor-outages-p256', ['p256']],
  ]) {
    const options = liveProfileOptions(/** @type {any} */ (profile));
    assert.equal(options.survivorOutages, true);
    assert.equal(options.lifecycle, true);
    assert.equal(options.combined, true);
    assert.deepEqual(options.arms, arms);
  }
});

test('host crash evidence must name exactly the requested boundary', () => {
  const fault = 'call:0:after-submit';
  requireExpectedHostCrash({ code: 86, messages: [{ crash: fault }] }, fault);
  for (const result of [
    { code: 1, messages: [{ crash: fault }] },
    { code: 86, messages: [] },
    { code: 86, messages: [{ crash: 'deploy:0:after-submit' }] },
    { code: 86, messages: [{ crash: fault }, { crash: fault }] },
  ])
    assert.throws(() => requireExpectedHostCrash(result, fault));
});
