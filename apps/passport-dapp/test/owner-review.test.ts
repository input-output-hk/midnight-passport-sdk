import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import type { AuthenticatedJubjubOwner } from '@input-output-hk/mn-passport-keys';
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { routeAuthenticatedAccount } from '../src/owner-access.js';
import { createOwnerReview } from '../src/owner-review.js';
import {
  assertExactGrantExport,
  assertExactWithdrawal,
  beforeDemoCeremony,
  reviewDemoAction,
} from '../src/consent.js';
import { approve, control, withUi } from './fixtures/consent-ui.js';

const address = 'ab'.repeat(32);
const grantId = 'ef'.repeat(32);
const recipient = '12'.repeat(32);
const transfer = {
  color: '00'.repeat(32),
  amount: '1',
  recipient,
  recipientAddress: MidnightBech32m.encode(
    'undeployed',
    new UnshieldedAddress(Buffer.from(recipient, 'hex')),
  ).asString(),
  balance: '10',
  outsideSession: false,
};
type OwnerLease = Pick<AuthenticatedJubjubOwner, 'context' | 'check'>;
const ceremony = { purpose: 'derive-keys' as const, rpId: 'localhost', attempt: 1 };

function fixture(authenticated = true, primaryScheme: PassportAccount['scheme'] = 'p256-webauthn') {
  let reviewValid = true,
    leaseValid = true,
    ownerValid = true;
  const effects: string[] = [];
  const check = () => {
    if (!reviewValid) throw Error('Review expired');
  };
  const ownerLease: OwnerLease = {
    context: {
      account: address,
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      credentialId: Uint8Array.of(1),
    },
    check() {
      if (!ownerValid) throw Error('Owner expired');
    },
  };
  const makeAccount = (scheme: PassportAccount['scheme']): PassportAccount => ({
    address,
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    scheme,
    credentialId: Uint8Array.of(1),
    state: async () => ({
      booted: true,
      authNonce: 1n,
      deviceEpoch: 0n,
      entryCount: 1,
      specVersion: 1,
    }),
    rotateEncryptionKey: async () => ({ txHash: 'unused' }),
    withdrawUnshielded: async (request) => {
      if (!authenticated) await beforeDemoCeremony({ ...ceremony, purpose: 'sign' });
      assert.ok(scheme === 'p256-webauthn' || scheme === 'jubjub-schnorr');
      assertExactWithdrawal({ account: address, scheme, ...request });
      effects.push(scheme);
      return { txHash: '34'.repeat(32), nextUseCounter: 2n };
    },
  });
  const originalPrimary = makeAccount(primaryScheme);
  const signer = makeAccount('jubjub-schnorr');
  const refs: {
    primary: PassportAccount | undefined;
    authenticated: PassportAccount | undefined;
    current: PassportAccount | undefined;
    owner: OwnerLease | undefined;
  } = {
    primary: originalPrimary,
    authenticated: authenticated ? signer : undefined,
    current: undefined,
    owner: authenticated ? ownerLease : undefined,
  };
  const facade = routeAuthenticatedAccount(
    originalPrimary,
    () => refs.authenticated,
    check,
    async () => beforeDemoCeremony(ceremony),
  );
  refs.current = facade;
  const confirmations: string[] = [];
  let confirm = true;
  const review = createOwnerReview({
    current: () => refs.current,
    primary: () => refs.primary,
    authenticated: () => refs.authenticated,
    ownerSession: () => refs.owner,
    lease: () =>
      authenticated
        ? () => {
            if (!leaseValid) throw Error('Lease expired');
          }
        : undefined,
    check,
    confirm: (text) => {
      confirmations.push(text);
      return confirm;
    },
  });
  return {
    review,
    refs,
    facade,
    signer,
    originalPrimary,
    effects,
    confirmations,
    context: {
      account: address,
      network: 'undeployed',
      arm: primaryScheme === 'p256-webauthn' ? ('p256' as const) : ('jubjub' as const),
      ownerUnlocked: authenticated,
    },
    invalidate: {
      review: () => (reviewValid = false),
      lease: () => (leaseValid = false),
      owner: () => (ownerValid = false),
    },
    decline: () => (confirm = false),
  };
}

test('P256 facade reviews its authenticated JubJub signer and dispatches only that exact route', async () =>
  withUi(async (controls, frames) => {
    const f = fixture();
    assert.notEqual(f.facade, f.signer);
    assert.equal(f.originalPrimary.scheme, 'p256-webauthn');
    assert.equal(f.facade.scheme, 'jubjub-schnorr');
    await reviewDemoAction('withdraw', f.context);
    f.review.stageOwnerWithdrawalReview(f.facade, transfer);
    assert.ok(f.facade.withdrawUnshielded);
    const pending = f.facade.withdrawUnshielded(transfer);
    const text = control(controls, 'ceremony-details').textContent;
    assert.match(text, /JubJub owner after fresh passkey approval/);
    assert.match(text, /Amount: 1 smallest units/);
    assert.ok(text.includes(transfer.recipientAddress));
    await approve(controls, frames);
    assert.equal((await pending).txHash, '34'.repeat(32));
    assert.deepEqual(f.effects, ['jubjub-schnorr']);
  }));

test('grant export uses the actual authenticated signer context and pins the selected grant', async () =>
  withUi(async (controls, frames) => {
    const f = fixture();
    await reviewDemoAction('exportGrant', f.context);
    f.review.stageGrantExportReview(f.facade, grantId);
    const pending = beforeDemoCeremony(ceremony);
    const text = control(controls, 'ceremony-details').textContent;
    assert.ok(text.includes(grantId));
    assert.match(text, /JubJub owner after fresh passkey approval/);
    await approve(controls, frames);
    await pending;
    assert.doesNotThrow(() => assertExactGrantExport(address, grantId));
    assert.throws(() => assertExactGrantExport(address, 'cd'.repeat(32)));
  }));

for (const scheme of ['p256-webauthn', 'jubjub-schnorr'] as const) {
  test(`primary ${scheme} review works without an authenticated owner or owner lease`, async () =>
    withUi(async (controls, frames) => {
      const f = fixture(false, scheme);
      await reviewDemoAction('withdraw', f.context);
      f.review.stageOwnerWithdrawalReview(f.facade, transfer);
      assert.ok(f.facade.withdrawUnshielded);
      const pending = f.facade.withdrawUnshielded(transfer);
      assert.ok(
        !control(controls, 'ceremony-details').textContent.includes('fresh passkey approval'),
      );
      await approve(controls, frames);
      await pending;
      assert.deepEqual(f.effects, [scheme]);
    }));
}

for (const reference of ['current', 'primary', 'authenticated', 'owner'] as const) {
  test(`replacement of the captured ${reference} during review refuses before effect`, async () =>
    withUi(async (controls, frames) => {
      const f = fixture();
      await reviewDemoAction('withdraw', f.context);
      f.review.stageOwnerWithdrawalReview(f.facade, transfer);
      assert.ok(f.facade.withdrawUnshielded);
      const pending = f.facade.withdrawUnshielded(transfer);
      await approve(controls, frames, () => {
        if (reference === 'owner') f.refs.owner = undefined;
        else f.refs[reference] = undefined;
      });
      await assert.rejects(pending, /reviewed account or owner session changed/);
      assert.deepEqual(f.effects, []);
    }));
}

for (const fence of ['review', 'lease', 'owner'] as const) {
  test(`${fence} expiry during approval cannot become a primary-owner fallback`, async () =>
    withUi(async (controls, frames) => {
      const f = fixture();
      await reviewDemoAction('withdraw', f.context);
      f.review.stageOwnerWithdrawalReview(f.facade, transfer);
      assert.ok(f.facade.withdrawUnshielded);
      const pending = f.facade.withdrawUnshielded(transfer);
      await approve(controls, frames, f.invalidate[fence]);
      await assert.rejects(pending, /expired/);
      assert.deepEqual(f.effects, []);
    }));
}

test('an authenticated signer without its captured owner session fails closed before staging', async () =>
  withUi(async () => {
    const f = fixture();
    f.refs.owner = undefined;
    await reviewDemoAction('exportGrant', f.context);
    assert.throws(() => f.review.stageGrantExportReview(f.facade, grantId));
    assert.deepEqual(f.effects, []);
  }));

test('wrong signer context refuses; primary scheme on a facade does not hide a different account', async () =>
  withUi(async () => {
    const f = fixture();
    f.refs.authenticated = { ...f.signer, bindingId: 'different-binding' };
    await reviewDemoAction('withdraw', f.context);
    assert.throws(() => f.review.stageOwnerWithdrawalReview(f.facade, transfer));
    assert.deepEqual(f.effects, []);
  }));

test('scoped transfers keep an explicit exact decision without staging owner credentials', async () =>
  withUi(async (controls) => {
    const f = fixture(false);
    assert.equal(f.review.reviewScopedWithdrawal(f.facade, transfer), true);
    assert.equal(f.confirmations.length, 1);
    const text = f.confirmations[0];
    assert.ok(text?.includes(address));
    assert.ok(text?.includes('Amount: 1 smallest units'));
    assert.ok(text?.includes(transfer.recipientAddress));
    assert.match(text ?? '', /scoped JubJub session/);
    assert.equal(control(controls, 'ceremony-dialog').shows, 0);
    f.decline();
    assert.equal(f.review.reviewScopedWithdrawal(f.facade, transfer), false);
    assert.deepEqual(f.effects, []);
  }));
