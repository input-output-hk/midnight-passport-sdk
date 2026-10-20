// Synthetic credentials; copied only to an authorised disposable consumer checkout.
import { it, expect } from 'vitest';
import { createFakePasskey } from './fake-passkey';
import { createPasskeyAuthoriser } from '../../src/ceremony/passkey';
import { createPasskeyEncryptionKey } from '../../src/ceremony/encryption-key';
import { encodeDevicePublicKey } from '../../src/acc/envelopes';
import { recipeDeviceKeyring, recipeJubjubAuthoriser } from '@input-output-hk/mn-passport-keys';
import { pureCircuits } from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
const network = 'undeployed';
const account = 'ac'.repeat(32);
it('current host and packed SDK agree on authoriser and network-separated reader derivation', async () => {
  const { keySource } = createFakePasskey();
  const copies: Uint8Array[] = [];
  const origin = {
    ...keySource,
    deviceSecret: async () => {
      const b = await keySource.deviceSecret();
      copies.push(b);
      return b;
    },
    deriveSecret: async (p: any) => {
      const b = await keySource.deriveSecret(p);
      copies.push(b);
      return b;
    },
  };
  const sdk = recipeJubjubAuthoriser(origin, pureCircuits);
  const host = createPasskeyAuthoriser({ keySource });
  expect(await sdk.devicePublicKey()).toEqual(await host.devicePublicKey());
  const s = recipeDeviceKeyring(origin),
    h = createPasskeyEncryptionKey(keySource);
  expect(await s.readerPublicKey(network)).toEqual(await h.readerPublicKey(network));
  expect(await s.readerPublicKey('preview')).toEqual(await h.readerPublicKey('preview'));
  expect(await s.readerPublicKey(network)).not.toEqual(await s.readerPublicKey('preview'));
  expect(copies.length).toBeGreaterThan(0);
  for (const copy of copies) expect(copy).toEqual(new Uint8Array(copy.length));
});
it('current host and packed SDK open each others random viewing keys and authenticated registrations', async () => {
  const { keySource } = createFakePasskey();
  const host = createPasskeyEncryptionKey(keySource),
    sdk = recipeDeviceKeyring(keySource);
  const devicePublicKey = encodeDevicePublicKey(
    await createPasskeyAuthoriser({ keySource }).devicePublicKey(),
  );
  const fromHost = await host.createKeys(network, { devicePublicKey });
  const fromSdk = await sdk.createKeys(network, { devicePublicKey });
  expect(fromHost.encKey).not.toEqual(fromSdk.encKey);
  for (const [created, reader] of [
    [fromHost, sdk],
    [fromSdk, host],
  ] as const) {
    const keyring = { account, encKey: created.encKey, envelopes: created.envelopes };
    const opened = await reader.openInbox(network, keyring, created.registrations);
    expect(opened).toHaveLength(1);
    expect(opened[0]?.kind).toBe('device');
    expect((opened[0] as any).device.devicePublicKey).toBe(devicePublicKey);
    await expect(reader.openInbox('preview', keyring, created.registrations)).rejects.toThrow();
    await expect(
      reader.openInbox(network, { ...keyring, encKey: new Uint8Array(32) }, created.registrations),
    ).rejects.toThrow();
  }
});
it('current host and packed SDK exchange authenticated grant bookkeeping without secret bytes', async () => {
  const { keySource } = createFakePasskey();
  const host = createPasskeyEncryptionKey(keySource),
    sdk = recipeDeviceKeyring(keySource);
  const devicePublicKey = encodeDevicePublicKey(
    await createPasskeyAuthoriser({ keySource }).devicePublicKey(),
  );
  const created = await host.createKeys(network, { devicePublicKey });
  const keyring = { account, encKey: created.encKey, envelopes: created.envelopes };
  const grant = {
    grantId: 'ab'.repeat(32),
    slot: 3,
    scopeSalt: 'cd'.repeat(32),
    granteePublicKey: 'ef'.repeat(32),
    readPublicKey: '12'.repeat(32),
    object: { color: '34'.repeat(32), recipient: { kind: 'any' as const }, maxCoinValue: '10' },
  };
  for (const [writer, reader] of [
    [host, sdk],
    [sdk, host],
  ] as const) {
    const sealed = await writer.sealGrant(network, account as any, grant as any);
    const opened = await reader.openInbox(network, keyring, sealed);
    expect(opened).toHaveLength(2);
    expect(opened.every((entry) => entry?.kind === 'grant')).toBe(true);
    const parts = opened.map((entry) => (entry as any).record);
    expect(parts.find((part) => part.part === 'grant')).toMatchObject({
      grantId: grant.grantId,
      slot: grant.slot,
      readPublicKey: grant.readPublicKey,
    });
    expect(parts.find((part) => part.part === 'object')).toMatchObject({
      grantId: grant.grantId,
      object: grant.object,
    });
    for (const entry of sealed) expect(entry).toHaveLength(192);
  }
});
