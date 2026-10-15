import assert from 'node:assert/strict';
import { test } from 'node:test';
import { x25519 } from '@noble/curves/ed25519.js';
import { jubjub } from '@noble/curves/misc.js';
import { sealActiveReadGrants } from '../packages/account/dist/index.js';
import { recipeDeviceKeyring } from '../packages/keys/dist/index.js';

const account = 'ab'.repeat(32);
const first = 'cd'.repeat(32);
const missing = 'de'.repeat(32);
const except = 'ef'.repeat(32);
const networkId = 'undeployed';

async function fixture() {
  /** @type {import('../packages/account/dist/ports/index.js').PrfKeySource} */
  const source = {
    withSession: (operation) => operation(),
    deriveSecret: async () => new Uint8Array(32).fill(9),
    deviceSecret: async () => {
      throw new Error('unused');
    },
  };
  const viewingKey = recipeDeviceKeyring(source);
  const devicePublicKey = Buffer.from(jubjub.Point.BASE.toBytes()).toString('hex');
  const keys = await viewingKey.createKeys(networkId, { devicePublicKey });
  const keyring = { account, encKey: keys.encKey, envelopes: keys.envelopes };
  const grantee = x25519.keygen();
  /** @type {import('../packages/account/dist/read-grant-deliveries.js').ActiveReadGrantTarget[]} */
  const targets = [
    { grantId: first, readPublicKey: Buffer.from(grantee.publicKey).toString('hex') },
    { grantId: missing },
    { grantId: except, readPublicKey: Buffer.from(grantee.publicKey).toString('hex') },
  ];
  /** @type {import('../packages/account/dist/read-grant-deliveries.js').SealActiveReadGrantsPorts} */
  const ports = {
    random: (length) => new Uint8Array(length),
    viewingKey,
    targets: {
      readActiveReadGrantTargets: async (address) => {
        assert.equal(address, account);
        return { authNonce: 5n, targets };
      },
    },
  };
  return { ports, keyring, targets, grantee };
}

test('seals only chain-confirmed remaining readers and reports unknown keys', async () => {
  const { ports, keyring, grantee } = await fixture();
  const result = await sealActiveReadGrants(
    { networkId, keyring, authNonce: 5n, exceptGrantId: except },
    ports,
  );
  assert.deepEqual(result.unsealedGrantIds, [missing]);
  assert.equal(result.sealed.length, 1);
  const delivery = result.sealed[0];
  assert.equal(delivery?.grantId, first);
  assert.equal(delivery?.seal.length, 94);
  assert.equal(delivery?.entry.length, 192);
  assert.equal(delivery?.sealedEncKey, Buffer.from(keyring.encKey).toString('hex'));
  assert.deepEqual(await ports.viewingKey.openInbox(networkId, keyring, [delivery.entry]), [
    {
      kind: 'grant',
      record: {
        part: 'view',
        grantId: first,
        encKeyPrefix: delivery.sealedEncKey.slice(0, 6),
        seal: Buffer.from(delivery.seal).toString('hex'),
      },
    },
  ]);
  grantee.secretKey.fill(0);
});

test('revoke-all validates the live read roster without sealing any grantee', async () => {
  const { ports, keyring, targets, grantee } = await fixture();
  const result = await sealActiveReadGrants(
    { networkId, keyring, authNonce: 5n, exceptAll: true },
    ports,
  );
  assert.deepEqual(result.targets, targets);
  assert.deepEqual(result.sealed, []);
  assert.deepEqual(result.unsealedGrantIds, []);
  grantee.secretKey.fill(0);
});

test('malformed or duplicated active targets are refused before sealing', async () => {
  const { ports, keyring, targets, grantee } = await fixture();
  targets.push({ grantId: first });
  await assert.rejects(sealActiveReadGrants({ networkId, keyring, authNonce: 5n }, ports), {
    code: 'GrantScopeInvalid',
  });
  targets.pop();
  targets[0] = { grantId: first, readPublicKey: 'ff' };
  await assert.rejects(sealActiveReadGrants({ networkId, keyring, authNonce: 5n }, ports), {
    code: 'GrantScopeInvalid',
  });
  grantee.secretKey.fill(0);
});

test('a stale grant map cannot authorise delivery for the current ACC nonce', async () => {
  const { ports, keyring, grantee } = await fixture();
  await assert.rejects(sealActiveReadGrants({ networkId, keyring, authNonce: 6n }, ports), {
    code: 'GrantRosterUnsettled',
  });
  grantee.secretKey.fill(0);
});

test('a failed key seam reports unsealed; an unrelated record is rejected', async () => {
  const { ports, keyring, targets, grantee } = await fixture();
  targets.splice(1);
  const original = ports.viewingKey;
  /** @type {import('../packages/account/dist/read-grant-deliveries.js').SealActiveReadGrantsPorts} */
  const failingPorts = {
    ...ports,
    viewingKey: {
      ...original,
      sealView: async () => {
        throw new Error('key session expired');
      },
    },
  };
  const unsealed = await sealActiveReadGrants({ networkId, keyring, authNonce: 5n }, failingPorts);
  assert.deepEqual(unsealed.targets, targets);
  assert.deepEqual(unsealed.sealed, []);
  assert.deepEqual(unsealed.unsealedGrantIds, [first]);
  if (!original.sealView) throw new Error('missing view seal');
  const sealView = original.sealView;
  /** @type {import('../packages/account/dist/read-grant-deliveries.js').SealActiveReadGrantsPorts} */
  const unrelatedPorts = {
    ...ports,
    viewingKey: {
      ...original,
      sealView: (network, ring, request) =>
        sealView(network, ring, { ...request, grantId: except }),
    },
  };
  await assert.rejects(
    sealActiveReadGrants({ networkId, keyring, authNonce: 5n }, unrelatedPorts),
    {
      code: 'InternalError',
    },
  );
  grantee.secretKey.fill(0);
});

test('cancellation during sealing is not treated as an unsealed grant', async () => {
  const { ports, keyring, targets, grantee } = await fixture();
  targets.splice(1);
  const controller = new AbortController();
  const cancelled = {
    ...ports,
    viewingKey: {
      ...ports.viewingKey,
      sealView: async () => {
        controller.abort();
        throw new Error('cancelled');
      },
    },
  };
  await assert.rejects(
    sealActiveReadGrants(
      { networkId, keyring, authNonce: 5n, signal: controller.signal },
      cancelled,
    ),
    { code: 'Aborted' },
  );
  grantee.secretKey.fill(0);
});
