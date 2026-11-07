import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BackgroundError } from '@input-output-hk/mn-passport-account/background';
import { validateWalletReply, walletBackgroundError } from '../src/wallet/dev-wallet.js';

test('worker failures keep the connector API error taxonomy and never expose provider details', () => {
  for (const code of ['Closed', 'Unavailable'] as const) {
    const error = walletBackgroundError(new BackgroundError(code));
    assert.equal(error.type, 'DAppConnectorAPIError');
    assert.equal(error.code, 'Disconnected');
  }
  const error = walletBackgroundError(new Error('private-provider-detail'));
  assert.equal(error.type, 'DAppConnectorAPIError');
  assert.equal(error.code, 'InternalError');
  assert.doesNotMatch(error.reason, /private-provider/);
  assert.equal(error.cause, undefined);
});

test('worker reply validation strips extensions and refuses malformed balances before UI publication', () => {
  assert.deepEqual(
    validateWalletReply('getUnshieldedAddress', {
      unshieldedAddress: 'test',
      privateExtension: 'drop',
    }),
    { unshieldedAddress: 'test' },
  );
  assert.deepEqual(validateWalletReply('getUnshieldedBalances', { ['00'.repeat(32)]: 1n }), {
    ['00'.repeat(32)]: 1n,
  });
  for (const value of [
    null,
    [],
    { bad: 1n },
    { ['00'.repeat(32)]: -1n },
    { ['00'.repeat(32)]: '1' },
  ])
    assert.throws(() => validateWalletReply('getUnshieldedBalances', value), /Invalid worker/);
  assert.throws(() => validateWalletReply('getDustBalance', { balance: 1n }), /Invalid worker/);
  assert.throws(
    () =>
      validateWalletReply('getConnectionStatus', {
        status: 'disconnected',
        networkId: 'undeployed',
      }),
    /Invalid worker/,
  );
});
