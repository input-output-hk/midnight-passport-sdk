import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jubjub } from '@noble/curves/misc.js';
import { MidnightBech32m, UnshieldedAddress } from '@midnightntwrk/wallet-sdk-address-format';
import { fixedUnshieldedGrant } from '../src/grant-input.ts';

const grantee = Buffer.from(jubjub.Point.BASE.toBytes()).toString('hex');
const recipient = MidnightBech32m.encode(
  'undeployed',
  new UnshieldedAddress(Buffer.alloc(32, 7)),
).asString();
const input = {
  grantee,
  color: '00'.repeat(32),
  recipient,
  perCallCap: '4',
  cap: '10',
  maxDemoCall: '10',
};

test('demo grant pins one asset, one recipient and bounded unshielded spend', () => {
  assert.deepEqual(fixedUnshieldedGrant('undeployed', input), {
    grantee: { scheme: 'jubjub-schnorr', publicKey: grantee },
    operations: ['withdraw-unshielded'],
    color: input.color,
    recipient: { kind: 'user-address', value: '07'.repeat(32) },
    maxCoinValue: '10',
    perCallCap: '4',
    cap: '10',
    expiresAt: null,
  });
});

test('demo grant refuses wrong network, invalid key and caps above service limit', () => {
  const mainnet = MidnightBech32m.encode(
    'mainnet',
    new UnshieldedAddress(Buffer.alloc(32, 7)),
  ).asString();
  for (const changed of [
    { grantee: '0'.repeat(64) },
    { recipient: mainnet },
    { perCallCap: '11' },
    { perCallCap: '0' },
    { cap: '3' },
    { cap: '01' },
  ]) {
    assert.throws(() => fixedUnshieldedGrant('undeployed', { ...input, ...changed }));
  }
});
