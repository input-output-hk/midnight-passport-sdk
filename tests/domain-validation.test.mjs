import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AccountAddressSchema,
  AssetIdSchema,
  RecipientSchema,
  AmountSchema,
  AccountContextSchema,
  BindingIdSchema,
  NetworkIdSchema,
} from '../packages/account/dist/validation.js';
import {
  prepareUnshieldedWithdrawal,
  prepareShieldedWithdrawal,
} from '../packages/account/dist/unshielded-withdrawal.js';

test('canonical branded identifiers reject alternate encodings and invalid scopes', () => {
  for (const schema of [AccountAddressSchema, AssetIdSchema, RecipientSchema]) {
    assert.equal(schema.parse('ab'.repeat(32)), 'ab'.repeat(32));
    for (const value of ['AB'.repeat(32), '0x' + 'ab'.repeat(32), 'ab'.repeat(31), null, 32])
      assert.equal(schema.safeParse(value).success, false);
  }
  for (const schema of [BindingIdSchema, NetworkIdSchema]) {
    assert.equal(schema.parse('acc-s3r1.1'), 'acc-s3r1.1');
    for (const value of ['', '../bad', 'bad\n', 'x'.repeat(129)])
      assert.equal(schema.safeParse(value).success, false);
  }
  const parsed = AccountContextSchema.parse({
    account: 'ab'.repeat(32),
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    secret: 'strip',
  });
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal('secret' in parsed, false);
});

test('amount parsing bounds input before BigInt and preserves exact u128 values', () => {
  for (const value of ['1', ((1n << 128n) - 1n).toString()])
    assert.equal(AmountSchema.parse(value), value);
  for (const value of [
    '',
    '0',
    '01',
    '-1',
    '1.0',
    '1e3',
    ' 1',
    'abc',
    '9'.repeat(100_000),
    (1n << 128n).toString(),
    1n,
  ]) {
    assert.equal(AmountSchema.safeParse(value).success, false);
  }
  const request = { color: '00'.repeat(32), recipient: '12'.repeat(32), amount: '1' };
  assert.equal(prepareUnshieldedWithdrawal(request).amount, 1n);
  assert.equal(prepareShieldedWithdrawal({ ...request, inboxIndex: 0 }).inboxIndex, 0);
  for (const value of [
    { ...request, amount: '9'.repeat(100_000) },
    { ...request, amount: '0' },
  ])
    assert.throws(() => prepareUnshieldedWithdrawal(value), { code: 'TransferInvalid' });
  for (const inboxIndex of [-1, NaN, 1.5, Infinity])
    assert.throws(() => prepareShieldedWithdrawal({ ...request, inboxIndex }), {
      code: 'TransferInvalid',
    });
});
