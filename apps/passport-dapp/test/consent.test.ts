import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reviewedAccount } from '../src/consent.ts';

const context = {
  network: 'undeployed',
  arm: 'p256' as const,
  account: '11'.repeat(32),
  target: '22'.repeat(32),
};
test('credential/account selection and holder spend never advertise a previous owner ACC as pinned', () => {
  for (const action of ['create', 'open', 'spendGrant'] as const) {
    const review = reviewedAccount(action, context);
    assert.equal(review.address, undefined);
    assert.ok(!review.label.includes(context.account));
  }
});
test('known-account and joiner preparation review their supplied target; owner actions review the current ACC', () => {
  for (const action of ['openAt', 'prepareJoiner', 'prepareGrantee'] as const)
    assert.equal(reviewedAccount(action, context).address, context.target);
  for (const action of ['rotate', 'removeDevice', 'enrollDevice', 'withdraw', 'wallet'] as const)
    assert.equal(reviewedAccount(action, context).address, context.account);
});
