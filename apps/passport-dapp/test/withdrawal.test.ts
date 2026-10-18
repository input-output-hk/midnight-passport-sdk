import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { withdrawalRequest } from '../src/withdrawal.ts';

const color = '00'.repeat(32);
const recipient = MidnightBech32m.encode(
  'undeployed',
  new UnshieldedAddress(Buffer.alloc(32, 7)),
).asString();

test('withdrawal accepts a network-matched user address and preserves the reviewed fields', () => {
  assert.deepEqual(withdrawalRequest('undeployed', color, ' 2 ', recipient, '5'), {
    color,
    amount: '2',
    recipient: '07'.repeat(32),
  });
});

test('withdrawal refuses a different network, address kind, malformed amount and stale balance', () => {
  const mainnet = MidnightBech32m.encode(
    'mainnet',
    new UnshieldedAddress(Buffer.alloc(32, 7)),
  ).asString();
  for (const invalid of [mainnet, '07'.repeat(32), recipient.replace('mn_addr', 'mn_dust')]) {
    assert.throws(() => withdrawalRequest('undeployed', color, '1', invalid, '5'));
  }
  for (const invalid of ['0', '01', '-1', '1.5', String(1n << 128n)]) {
    assert.throws(() => withdrawalRequest('undeployed', color, invalid, recipient, '5'));
  }
  assert.throws(() => withdrawalRequest('undeployed', 'x', '1', recipient, '5'));
  assert.throws(() => withdrawalRequest('undeployed', color, '6', recipient, '5'), {
    name: 'TransferInvalid',
    message: 'Amount exceeds the fresh ACC balance.',
  });
});
