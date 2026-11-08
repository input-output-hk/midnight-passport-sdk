import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import {
  beforeDemoCeremony,
  finishDemoConsent,
  reviewDemoAction,
  stageExactCredentialReview,
  assertExactWithdrawal,
  assertExactGrantExport,
} from '../src/consent.ts';
import { admitExactReview, withdrawalFromCall, type ExactReview } from '../src/exact-review.ts';
import { reviewedOwnerValueCall } from '../src/reviewed-value-call.ts';
import { withUi, control, approve } from './fixtures/consent-ui.ts';

const account = 'ab'.repeat(32);
const color = '00'.repeat(32);
const recipient = '12'.repeat(32);
const recipientAddress = MidnightBech32m.encode(
  'undeployed',
  new UnshieldedAddress(Buffer.from(recipient, 'hex')),
).asString();
const context = { network: 'undeployed', arm: 'p256' as const, account };
const intent: ExactReview = {
  kind: 'withdraw',
  account,
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  route: 'primary',
  scheme: 'p256-webauthn',
  color,
  amount: '1',
  recipient,
  recipientAddress,
  balance: '10',
  outsideSession: false,
};
const request = {
  address: account,
  circuit: 'withdraw_unshielded_with_p256',
  args: [Buffer.from(color, 'hex'), 1n, { bytes: Buffer.from(recipient, 'hex') }],
};
const ceremony = { purpose: 'sign' as const, rpId: 'localhost', attempt: 1 };

test('staging is not approval; one actual signature review approves the immutable transfer', async () =>
  withUi(async (controls, frames) => {
    await reviewDemoAction('withdraw', context);
    const mutable = { ...intent };
    stageExactCredentialReview(mutable, () => {});
    assert.equal(control(controls, 'ceremony-dialog').shows, 0);
    assert.throws(() => assertExactWithdrawal(withdrawalFromCall(request)), {
      code: 'UserCancelled',
    });
    mutable.amount = '9';
    const pending = beforeDemoCeremony(ceremony);
    const text = control(controls, 'ceremony-details').textContent;
    assert.match(text, /Amount: 1 smallest units/);
    assert.ok(text.includes(recipientAddress));
    assert.ok(!text.includes('Amount: 9'));
    await approve(controls, frames);
    await pending;
    assert.doesNotThrow(() => assertExactWithdrawal(withdrawalFromCall(request)));
    for (const changed of [
      { account: 'cd'.repeat(32) },
      { color: '34'.repeat(32) },
      { amount: '2' },
      { recipient: '56'.repeat(32) },
      { scheme: 'jubjub-schnorr' as const },
    ])
      assert.throws(() => assertExactWithdrawal({ ...withdrawalFromCall(request), ...changed }), {
        code: 'UserCancelled',
      });
    finishDemoConsent();
    assert.throws(() => assertExactWithdrawal(withdrawalFromCall(request)), {
      code: 'UserCancelled',
    });
  }));

test('wrong action, context, route, human address or malformed value cannot stage a transfer', async () =>
  withUi(async () => {
    const changes = [
      { networkId: 'preview' },
      { account: 'cd'.repeat(32) },
      { route: 'authenticated-owner' as const, scheme: 'jubjub-schnorr' as const },
      { scheme: 'jubjub-schnorr' as const },
      { amount: '0' },
      { balance: '9'.repeat(40) },
      { recipient: '34'.repeat(32) },
    ];
    for (const changed of changes) {
      await reviewDemoAction('withdraw', context);
      assert.throws(() => stageExactCredentialReview({ ...intent, ...changed }, () => {}));
    }
    await reviewDemoAction('rotate', context);
    assert.throws(() => stageExactCredentialReview(intent, () => {}), { code: 'UserCancelled' });
    assert.throws(() => admitExactReview({ ...intent, kind: 'exportGrant', grantId: 'bad' }));
  }));

test('decline and preparation-only access cannot authorize transfer POST or sensitive export', async () =>
  withUi(async (controls) => {
    const originalFetch = globalThis.fetch;
    let sends = 0;
    globalThis.fetch = async () => {
      sends++;
      return new Response('{}');
    };
    try {
      await reviewDemoAction('withdraw', context);
      stageExactCredentialReview(intent, () => {});
      await assert.rejects(beforeDemoCeremony({ ...ceremony, purpose: 'identify' }), {
        code: 'UserCancelled',
      });
      assert.equal(control(controls, 'ceremony-dialog').shows, 0);
      const pending = beforeDemoCeremony(ceremony);
      control(controls, 'ceremony-cancel').click();
      await assert.rejects(pending, { code: 'UserCancelled' });
      assert.throws(() => reviewedOwnerValueCall('http://example.test', request), {
        code: 'UserCancelled',
      });
      assert.equal(sends, 0);
      await reviewDemoAction('exportGrant', context);
      stageExactCredentialReview(
        { ...intent, kind: 'exportGrant', grantId: 'ef'.repeat(32) },
        () => {},
      );
      assert.throws(() => assertExactGrantExport(account, 'ef'.repeat(32)), {
        code: 'UserCancelled',
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  }));

test('exact grant export is bound to one selected ID and current account', async () =>
  withUi(async (controls, frames) => {
    const grantId = 'ef'.repeat(32);
    let valid = true;
    await reviewDemoAction('exportGrant', context);
    stageExactCredentialReview({ ...intent, kind: 'exportGrant', grantId }, () => {
      if (!valid) throw Error('Account changed');
    });
    const pending = beforeDemoCeremony({ ...ceremony, purpose: 'derive-keys' });
    assert.ok(control(controls, 'ceremony-details').textContent.includes(grantId));
    await approve(controls, frames);
    await pending;
    assert.doesNotThrow(() => assertExactGrantExport(account, grantId));
    assert.throws(() => assertExactGrantExport(account, 'cd'.repeat(32)), {
      code: 'UserCancelled',
    });
    assert.throws(() => assertExactGrantExport('cd'.repeat(32), grantId), {
      code: 'UserCancelled',
    });
    valid = false;
    assert.throws(() => assertExactGrantExport(account, grantId), /Account changed/);
  }));

test('expiry during the sole exact review refuses without an effect', async () =>
  withUi(async (controls, frames) => {
    let valid = true;
    await reviewDemoAction('withdraw', context);
    stageExactCredentialReview(intent, () => {
      if (!valid) throw Error('Expired');
    });
    const pending = beforeDemoCeremony(ceremony);
    await approve(controls, frames, () => {
      valid = false;
    });
    await assert.rejects(pending, /Expired/);
    assert.throws(() => assertExactWithdrawal(withdrawalFromCall(request)), {
      code: 'UserCancelled',
    });
  }));

test('already dispatched value acknowledgement survives later local review expiry', async () =>
  withUi(async (controls, frames) => {
    let valid = true;
    await reviewDemoAction('withdraw', context);
    stageExactCredentialReview(intent, () => {
      if (!valid) throw Error('Expired');
    });
    const approval = beforeDemoCeremony(ceremony);
    await approve(controls, frames);
    await approval;
    const originalFetch = globalThis.fetch;
    let complete: ((value: Response) => void) | undefined;
    let sends = 0;
    globalThis.fetch = async () => {
      sends++;
      return new Promise<Response>((resolve) => {
        complete = resolve;
      });
    };
    try {
      const pending = reviewedOwnerValueCall('http://example.test', request);
      assert.equal(sends, 1);
      valid = false;
      finishDemoConsent();
      assert.ok(complete);
      complete(new Response(JSON.stringify({ txHash: '34'.repeat(32) })));
      assert.equal((await pending).txHash, '34'.repeat(32));
      assert.throws(() => reviewedOwnerValueCall('http://example.test', request), {
        code: 'UserCancelled',
      });
      assert.equal(sends, 1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  }));
