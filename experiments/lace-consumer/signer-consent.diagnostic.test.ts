// Copy to Lace's packages/module/passport-account/test/remote/ at the pinned merged head.
// These are negative compatibility checks against real hosted signer handlers, no localnet.
import { AccAddress } from '@lace-contract/passport';
import { createSignerClient, serveSignerRequests } from '@lace-lib/passkey';
import { afterEach, expect, it } from 'vitest';
import { encodeDevicePublicKey } from '../../src/acc/envelopes';
import { createRemotePassportAuthoriser } from '../../src/remote/remote-authoriser';
import { createRemoteEncryptionKey } from '../../src/remote/remote-encryption-key';
import { createPassportSignerHandlers } from '../../src/remote/signer-handlers';
import { createFakePasskey, createInMemoryStorage } from './fake-passkey';
import { createWindowPair, SIGNER_URL } from './fake-windows';
import type { SignerRequestHandlers } from '@lace-lib/passkey';

const cleanups: Array<() => void> = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
const unsupported = async (): Promise<never> => { throw new Error('Cardano is outside this check'); };
const networkId = 'undeployed';
const account = AccAddress('ab'.repeat(32));

async function connect() {
  const pair = createWindowPair();
  const passkey = createFakePasskey();
  const storage = createInMemoryStorage();
  const handlers: SignerRequestHandlers = {
    ...createPassportSignerHandlers({ keySource: passkey.keySource, createKeyValueStorage: storage.createKeyValueStorage }),
    'sign-cardano-tx': unsupported,
    'sign-cardano-data': unsupported,
    'cardano-account-public-key': unsupported,
    'cardano-custody-public-key': unsupported,
    'sign-cardano-custody-tx': unsupported,
    'sign-cardano-custody-data': unsupported,
  };
  const client = createSignerClient({ signerUrl: SIGNER_URL, host: pair.dappHost });
  client.open();
  cleanups.push(() => client.close());
  cleanups.push(serveSignerRequests({ handlers, assertOriginAllowed: () => undefined, onRequest: async () => 'approve', host: pair.signerHost }));
  await client.connect();
  return { authoriser: createRemotePassportAuthoriser(client), viewingKey: createRemoteEncryptionKey(client) };
}

it('creation consent refuses the SDK pre-activation sealed-registration validation', async () => {
  const { authoriser, viewingKey } = await connect();
  await authoriser.withKeySession!(async () => {
    const devicePublicKey = encodeDevicePublicKey(await authoriser.devicePublicKey());
    const keys = await viewingKey.createKeys(networkId, { devicePublicKey });
    await expect(viewingKey.openInbox(networkId, { account, encKey: keys.encKey, envelopes: keys.envelopes }, keys.registrations))
      .rejects.toMatchObject({ code: 'flow-scope' });
  }, { kind: 'create-account', lockAccount: true });
});

it('non-rotating enrollment consent refuses the SDK roster inbox read', async () => {
  const { authoriser, viewingKey } = await connect();
  const created = await authoriser.withKeySession!(async () => {
    const devicePublicKey = encodeDevicePublicKey(await authoriser.devicePublicKey());
    return { devicePublicKey, keys: await viewingKey.createKeys(networkId, { devicePublicKey }) };
  }, { kind: 'create-account', lockAccount: true });
  const reader = { readerPublicKey: '11'.repeat(32), devicePublicKey: created.devicePublicKey };
  await authoriser.withKeySession!(async () => {
    await expect(viewingKey.openInbox(networkId, { account, encKey: created.keys.encKey, envelopes: created.keys.envelopes }, created.keys.registrations))
      .rejects.toMatchObject({ code: 'flow-scope' });
  }, { kind: 'add-device', account, commitmentHex: '22'.repeat(32), reader });
});

it('sign-in validates the envelope but deliberately hides its device registration', async () => {
  const { authoriser, viewingKey } = await connect();
  const keys = await authoriser.withKeySession!(async () => viewingKey.createKeys(networkId, {
    devicePublicKey: encodeDevicePublicKey(await authoriser.devicePublicKey()),
  }), { kind: 'create-account', lockAccount: true });
  await authoriser.withKeySession!(async () => {
    const opened = await viewingKey.openInbox(networkId, { account, encKey: keys.encKey, envelopes: keys.envelopes }, keys.registrations);
    expect(opened).toEqual(keys.registrations.map(() => null));
  }, { kind: 'sign-in' });
});


it('an empty batch is a no-op and cannot validate the live viewing key', async () => {
  const { authoriser, viewingKey } = await connect();
  await authoriser.withKeySession!(async () => {
    await expect(viewingKey.openInbox(networkId, { account, encKey: new Uint8Array(32), envelopes: [] }, []))
      .resolves.toEqual([]);
    await expect(viewingKey.openInbox(networkId, { account, encKey: new Uint8Array(32), envelopes: [] }, [new Uint8Array(192)]))
      .rejects.toMatchObject({ code: 'encryption-key-mismatch' });
  }, { kind: 'sign-in' });
});
