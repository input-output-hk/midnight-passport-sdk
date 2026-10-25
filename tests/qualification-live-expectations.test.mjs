import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  liveProfileOptions,
  requireExpectedFailure,
  requireNoCurrentKey,
  WALLET_WINDOWS,
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
