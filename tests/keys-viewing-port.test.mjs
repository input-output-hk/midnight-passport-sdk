import assert from 'node:assert/strict';
import { test } from 'node:test';
import { x25519 } from '@noble/curves/ed25519.js';
import { jubjub } from '@noble/curves/misc.js';
import { recipeDeviceKeyring } from '../packages/keys/dist/index.js';
import { sealInboxCoin } from '../packages/keys/dist/inbox-coin.js';

test('viewing port opens devices, grants and coins, and seals a read grant', async () => {
  /** @type {import('../packages/account/dist/ports/index.js').PrfKeySource} */
  const source = {
    withSession: (operation) => operation(),
    deriveSecret: async () => new Uint8Array(32).fill(9),
    async deviceSecret() {
      throw new Error('unused');
    },
  };
  const key = recipeDeviceKeyring(source);
  const devicePublicKey = Buffer.from(jubjub.Point.BASE.toBytes()).toString('hex');
  const created = await key.createKeys('undeployed', { devicePublicKey });
  const account = 'ab'.repeat(32);
  const keyring = { account, encKey: created.encKey, envelopes: created.envelopes };
  const grantee = x25519.keygen();
  /** @type {import('../packages/account/dist/ports/index.js').GrantBookkeeping} */
  const grant = {
    grantId: 'cd'.repeat(32),
    slot: 4,
    scopeSalt: 'ef'.repeat(32),
    granteePublicKey: '12'.repeat(32),
    readPublicKey: Buffer.from(grantee.publicKey).toString('hex'),
    object: {
      color: '34'.repeat(32),
      recipient: { kind: 'any' },
      maxCoinValue: '123',
    },
  };
  const grantEntries = await key.sealGrant('undeployed', account, grant);
  assert.equal(grantEntries.length, 2);
  const coin = { nonce: new Uint8Array(32).fill(1), color: new Uint8Array(32).fill(2), value: 5n };
  const coinEntry = await sealInboxCoin(created.encKey, coin);
  const registration = created.registrations[0];
  assert.ok(registration);
  const opened = await key.openInbox('undeployed', keyring, [
    registration,
    ...grantEntries,
    coinEntry,
    new Uint8Array(192),
  ]);
  assert.deepEqual(opened, [
    {
      kind: 'device',
      device: {
        readerPublicKey: Buffer.from(await key.readerPublicKey('undeployed')).toString('hex'),
        devicePublicKey,
      },
    },
    {
      kind: 'grant',
      record: {
        part: 'grant',
        grantId: grant.grantId,
        slot: grant.slot,
        scopeSalt: grant.scopeSalt,
        granteePublicKey: grant.granteePublicKey,
        readPublicKey: grant.readPublicKey,
      },
    },
    { kind: 'grant', record: { part: 'object', grantId: grant.grantId, object: grant.object } },
    { kind: 'coin', coin },
    null,
  ]);

  const sealView = key.sealView;
  assert.ok(sealView);
  assert.ok(grant.readPublicKey);
  const delivered = await sealView('undeployed', keyring, {
    grantId: grant.grantId,
    account,
    readPublicKey: grant.readPublicKey,
  });
  assert.equal(delivered.seal.length, 94);
  assert.equal(delivered.entry.length, 192);
  assert.deepEqual(await key.openInbox('undeployed', keyring, [delivered.entry]), [
    {
      kind: 'grant',
      record: {
        part: 'view',
        grantId: grant.grantId,
        encKeyPrefix: Buffer.from(created.encKey.subarray(0, 3)).toString('hex'),
        seal: Buffer.from(delivered.seal).toString('hex'),
      },
    },
  ]);

  // Open the grant's seal independently with the grantee key and bound grant/account data.
  const seal = delivered.seal;
  const shared = x25519.getSharedSecret(grantee.secretKey, seal.subarray(2, 34));
  const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const grantBytes = Buffer.from(grant.grantId, 'hex');
  const accountBytes = Buffer.from(account, 'hex');
  const viewKey = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(),
      info: Buffer.concat([new TextEncoder().encode('midnight:account:grant:view:v1'), grantBytes]),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const accountSecret = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: seal.subarray(34, 46),
        additionalData: Buffer.concat([seal.subarray(0, 34), grantBytes, accountBytes]),
      },
      viewKey,
      Buffer.concat([seal.subarray(62, 94), seal.subarray(46, 62)]),
    ),
  );
  assert.deepEqual(x25519.getPublicKey(accountSecret), created.encKey);
  await assert.rejects(
    crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: seal.subarray(34, 46),
        additionalData: Buffer.concat([
          seal.subarray(0, 34),
          grantBytes,
          Buffer.from('aa'.repeat(32), 'hex'),
        ]),
      },
      viewKey,
      Buffer.concat([seal.subarray(62, 94), seal.subarray(46, 62)]),
    ),
  );
  await assert.rejects(
    sealView('undeployed', keyring, {
      grantId: grant.grantId,
      account: 'aa'.repeat(32),
      readPublicKey: grant.readPublicKey,
    }),
    /does not match/,
  );
  accountSecret.fill(0);
  shared.fill(0);
  grantee.secretKey.fill(0);
});
