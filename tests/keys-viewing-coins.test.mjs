import assert from 'node:assert/strict';
import { test } from 'node:test';
import { x25519 } from '@noble/curves/ed25519.js';
import { jubjub } from '@noble/curves/misc.js';
import { recipeDeviceKeyring } from '../packages/keys/dist/index.js';
import { openInboxCoin, sealInboxCoin } from '../packages/keys/dist/inbox-coin.js';

test('an enrolled reader opens coins from the live and previous ACC secrets', async () => {
  /** @type {import('../packages/account/dist/ports/index.js').PrfKeySource} */
  const source = {
    withSession: (operation) => operation(),
    deriveSecret: async () => new Uint8Array(32).fill(11),
    async deviceSecret() {
      throw new Error('unused');
    },
  };
  const key = recipeDeviceKeyring(source);
  const devicePublicKey = Buffer.from(jubjub.Point.BASE.toBytes()).toString('hex');
  const oldKeys = await key.createKeys('undeployed', { devicePublicKey });
  const oldRing = {
    account: 'aa'.repeat(32),
    encKey: oldKeys.encKey,
    envelopes: oldKeys.envelopes,
  };
  const newKeys = await key.createKeys('undeployed', { devicePublicKey, keyring: oldRing });
  const keyring = {
    account: oldRing.account,
    encKey: newKeys.encKey,
    envelopes: [...newKeys.envelopes, ...oldKeys.envelopes],
  };
  const oldCoin = {
    nonce: new Uint8Array(32).fill(1),
    color: new Uint8Array(32).fill(2),
    value: 3n,
  };
  const newCoin = {
    nonce: new Uint8Array(32).fill(4),
    color: new Uint8Array(32).fill(5),
    value: 6n,
  };
  const oldEntry = await sealInboxCoin(oldKeys.encKey, oldCoin);
  const newEntry = await sealInboxCoin(newKeys.encKey, newCoin);
  assert.deepEqual(
    await key.openCoins('undeployed', keyring, [oldEntry, newEntry, new Uint8Array(192)]),
    [oldCoin, newCoin, null],
  );

  const target = x25519.keygen();
  const resealed = await key.reencryptCoins('undeployed', { keyring, to: target.publicKey }, [
    oldEntry,
    newEntry,
    new Uint8Array(192),
  ]);
  assert.equal(resealed.length, 3);
  assert.ok(resealed[0] && resealed[1]);
  assert.deepEqual(await openInboxCoin(target.secretKey, resealed[0]), oldCoin);
  assert.deepEqual(await openInboxCoin(target.secretKey, resealed[1]), newCoin);
  assert.equal(resealed[2], null);
  target.secretKey.fill(0);
});
