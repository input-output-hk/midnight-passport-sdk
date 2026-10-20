import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jubjub } from '@noble/curves/misc.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  createGrantBookkeepingRecovery,
  createPassportAccounts,
  prepareJubjubGrant,
} from '../packages/account/dist/index.js';
import { createFakePorts } from '../packages/account/dist/testing/index.js';
import { recipeDeviceKeyring, recipeJubjubAuthoriser } from '../packages/keys/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
const hex = (/** @type {Uint8Array} */ v) => Buffer.from(v).toString('hex');
const source = (n = 7) => ({
  withSession: async (/** @type {()=>Promise<any>} */ work) => work(),
  deviceSecret: async () => new Uint8Array(32).fill(n),
  deriveSecret: async () => new Uint8Array(32).fill(n),
});

async function fixture() {
  const keyring = recipeDeviceKeyring(source()),
    fake = createFakePorts({ binding: { pureCircuits } });
  /** @type {import('../packages/account/dist/ports/index.js').PassportPorts} */
  const ports = {
    ...fake,
    viewingKey: keyring,
    authoriser: { ...fake.authoriser, withKeySession: async (work) => work() },
    holdings: { selectHeldEntries: async () => [] },
    readGrants: {
      readActiveReadGrantTargets: async () => ({
        authNonce: [...fake.ledger.values()][0]?.authNonce ?? 0n,
        targets: [],
      }),
    },
  };
  const account = await createPassportAccounts(ports).createAccount({
    userName: 'synthetic',
    retireAuthority: true,
  });
  const ledger = fake.ledger.get(account.address);
  assert.ok(ledger);
  ledger.specVersion = 3;
  const scope = {
    grantee: {
      scheme: /** @type {const} */ ('jubjub-schnorr'),
      publicKey: hex(jubjub.Point.BASE.toBytes()),
    },
    operations: /** @type {const} */ (['withdraw-unshielded']),
    color: '34'.repeat(32),
    recipient: /** @type {const} */ ({ kind: 'any' }),
    maxCoinValue: '100',
    perCallCap: '10',
    cap: '100',
    expiresAt: 2000,
    read: true,
    rpId: 'example.org',
    readPublicKey: hex(x25519.getPublicKey(new Uint8Array(32).fill(22))),
  };
  const prepared = prepareJubjubGrant(
    {
      account: account.address,
      origin: 'example.org',
      scope,
      activeGrantIds: [],
      nowSeconds: 1000,
    },
    pureCircuits,
    (length) => new Uint8Array(length).fill(9),
  );
  const bookkeeping = {
    grantId: prepared.grantId,
    slot: prepared.slot,
    scopeSalt: hex(prepared.scopeSalt),
    granteePublicKey: scope.grantee.publicKey,
    readPublicKey: scope.readPublicKey,
    object: { color: scope.color, recipient: scope.recipient, maxCoinValue: scope.maxCoinValue },
  };
  ledger.inboxEntries.push(
    ...(await keyring.sealGrant('undeployed', account.address, bookkeeping)),
  );
  const live = {
    active: true,
    read: true,
    authNonce: ledger.authNonce,
    objectCommit: prepared.objectCommit,
    readPkHash: sha256(Buffer.from(scope.readPublicKey, 'hex')),
  };
  const config = {
    networkId: 'undeployed',
    origin: 'example.org',
    chain: fake.chain,
    viewingKey: keyring,
    commitments: { readGrantCommitment: async () => ({ ...live, authNonce: ledger.authNonce }) },
    pure: pureCircuits,
  };
  return { fake, ports, keyring, account, ledger, bookkeeping, live, config };
}

test('profile loss/reload reconstructs only published bookkeeping using the same reader and live commitments', async () => {
  const f = await fixture();
  const recovery = createGrantBookkeepingRecovery({
    ...f.config,
    viewingKey: recipeDeviceKeyring(source()),
  });
  assert.deepEqual(await recovery.recover(f.account.address, f.bookkeeping.grantId), f.bookkeeping);
  assert.equal(
    await recovery.readReadPublicKey(f.account.address, f.bookkeeping.grantId),
    f.bookkeeping.readPublicKey,
  );
  // No full scope or signing secret was manufactured, and no local journal is consulted.
  assert.equal(
    'scopeDigest' in (await recovery.recover(f.account.address, f.bookkeeping.grantId)),
    false,
  );
  const before = f.ledger.inboxEntries.length;
  assert.equal(f.ledger.inboxEntries.length, before);
  const record = f.ledger.inboxEntries.at(-1);
  assert.ok(record);
  f.ledger.inboxEntries.push(record);
  assert.deepEqual(
    await recovery.recover(f.account.address, f.bookkeeping.grantId),
    f.bookkeeping,
    'identical duplicates are benign',
  );
});

test('another enrolled device opens the ACC but cannot invent the issuing reader’s grant opening', async () => {
  const f = await fixture(),
    other = recipeDeviceKeyring(source(11)),
    authoriser = recipeJubjubAuthoriser(source(11), pureCircuits);
  assert.ok(f.account.addDevice);
  await f.account.addDevice({
    readerPublicKey: hex(await other.readerPublicKey('undeployed')),
    devicePublicKey: await authoriser.devicePublicKeyHex(),
  });
  // Enrolled and able to open the viewing context, but d3 records use a distinct reader key.
  await other.openInbox(
    'undeployed',
    { account: f.account.address, encKey: f.ledger.encKey, envelopes: f.ledger.inboxEntries },
    f.ledger.inboxEntries,
  );
  await assert.rejects(
    createGrantBookkeepingRecovery({ ...f.config, viewingKey: other }).recover(
      f.account.address,
      f.bookkeeping.grantId,
    ),
    { code: 'GrantBookkeepingUnsettled' },
  );
});

test('revoked, replaced, wrong-origin, incomplete and conflicting records fail closed', async () => {
  const f = await fixture(),
    recover = () =>
      createGrantBookkeepingRecovery(f.config).recover(f.account.address, f.bookkeeping.grantId);
  f.live.active = false;
  await assert.rejects(recover(), { code: 'GrantRevoked' });
  f.live.active = true;
  const commit = f.live.objectCommit;
  f.live.objectCommit = new Uint8Array(32);
  await assert.rejects(recover(), { code: 'GrantScopeInvalid' });
  f.live.objectCommit = commit;
  await assert.rejects(
    createGrantBookkeepingRecovery({ ...f.config, origin: 'other.example' }).recover(
      f.account.address,
      f.bookkeeping.grantId,
    ),
    { code: 'GrantScopeInvalid' },
  );
  const object = f.ledger.inboxEntries.pop();
  assert.ok(object);
  await assert.rejects(recover(), { code: 'GrantBookkeepingUnsettled' });
  f.ledger.inboxEntries.push(object);
  f.ledger.inboxEntries.push(
    ...(await f.keyring.sealGrant('undeployed', f.account.address, {
      ...f.bookkeeping,
      scopeSalt: '66'.repeat(32),
    })),
  );
  await assert.rejects(recover(), { code: 'GrantBookkeepingUnsettled' });
});

test('chain change during decryption and lagging grant snapshots are rejected', async () => {
  const f = await fixture();
  await assert.rejects(
    createGrantBookkeepingRecovery({
      ...f.config,
      viewingKey: {
        openInbox: async (...args) => {
          const result = await f.keyring.openInbox(...args);
          f.ledger.authNonce++;
          return result;
        },
      },
    }).recover(f.account.address, f.bookkeeping.grantId),
    { code: 'GrantBookkeepingUnsettled' },
  );
  await assert.rejects(
    createGrantBookkeepingRecovery({
      ...f.config,
      commitments: {
        readGrantCommitment: async () => ({ ...f.live, authNonce: f.ledger.authNonce - 1n }),
      },
    }).recover(f.account.address, f.bookkeeping.grantId),
    { code: 'GrantBookkeepingUnsettled' },
  );
});

test('reconstructed read key enables rotation; missing opening never becomes an empty grant roster', async () => {
  const f = await fixture(),
    recovery = createGrantBookkeepingRecovery(f.config);
  const ports = {
    ...f.ports,
    readGrants: {
      readActiveReadGrantTargets: async () => ({
        authNonce: f.ledger.authNonce,
        targets: [
          {
            grantId: f.bookkeeping.grantId,
            readPublicKey: /** @type {string} */ (
              await recovery.readReadPublicKey(f.account.address, f.bookkeeping.grantId)
            ),
          },
        ],
      }),
    },
  };
  const account = await createPassportAccounts(ports).openAccount();
  assert.ok(account.rotateViewingKey);
  const rotated = await account.rotateViewingKey();
  assert.equal(rotated.sealedReadGrants?.length, 1);
  const next = f.ledger.encKey.slice(),
    count = f.ledger.inboxEntries.length;
  // Lose the published object record, modelling an incomplete publication/profile backup.
  f.ledger.inboxEntries.splice(3, 1);
  await assert.rejects(account.rotateViewingKey(), { code: 'GrantBookkeepingUnsettled' });
  assert.deepEqual(f.ledger.encKey, next);
  assert.equal(f.ledger.inboxEntries.length, count - 1);
});
