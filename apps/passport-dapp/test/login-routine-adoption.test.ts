import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pureCircuits } from '#acc';
import {
  deriveSymmetricSecret,
  recipeDeviceKeyring,
  sealInboxCoin,
  seedFromRoot,
  type JubjubDeviceCircuits,
} from '@input-output-hk/mn-passport-keys';
import { createRoutineKeys, type RoutineAccount } from '../src/routine-keys.js';

const account: RoutineAccount = {
  address: 'ab'.repeat(32),
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  credentialId: Uint8Array.of(1, 2, 3),
  scheme: 'p256-webauthn',
};
const pageOrigin = 'http://localhost:5173';
const context = (value = account) => {
  assert.ok(value.credentialId);
  return {
    account: value.address,
    networkId: value.networkId,
    bindingId: value.bindingId,
    credentialId: value.credentialId.slice(),
  };
};
const seed = (byte = 9) => seedFromRoot(new Uint8Array(32).fill(byte));
const zeroed = (value: Uint8Array) => value.every((byte) => byte === 0);
function deferred() {
  let release: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}
function fixture() {
  let wall = 1_800_000;
  let monotonic = 1000;
  let unlocks = 0;
  let loadPure = async (): Promise<JubjubDeviceCircuits> => pureCircuits;
  const keys = createRoutineKeys({
    now: () => wall,
    monotonic: () => monotonic,
    pure: () => loadPure(),
    async unlock() {
      unlocks++;
      throw new Error('Login adoption must not request another credential');
    },
  });
  return {
    keys,
    unlocks: () => unlocks,
    time(w: number, m: number) {
      wall = w;
      monotonic = m;
    },
    pure(loader: () => Promise<JubjubDeviceCircuits>) {
      loadPure = loader;
    },
  };
}

test('verified login adopts the exact wallet seed once without requesting or retaining owner PRF', async () => {
  const f = fixture();
  const supplied = seed();
  const expected = supplied.slice();
  try {
    const adopt = f.keys.prepareLogin();
    await adopt(account, supplied, 15, 'localhost', pageOrigin);
    assert.equal(f.unlocks(), 0);
    assert.ok(zeroed(supplied));
    assert.equal(f.keys.snapshot().authority, 'routine');
    assert.equal(f.keys.snapshot().ownerVerified, undefined);
    assert.equal(f.keys.ownerSession(account), undefined);
    const first = f.keys.walletSeed(account);
    assert.ok(first);
    assert.equal(first.length, 64);
    assert.deepEqual(first, expected);
    first.fill(0);
    const second = f.keys.walletSeed(account);
    assert.ok(second);
    assert.deepEqual(second, expected);
    second.fill(0);
    const retry = seed(8);
    await assert.rejects(
      adopt(account, retry, 15, 'localhost', pageOrigin),
      /cancelled or superseded/,
    );
    assert.ok(zeroed(retry));
  } finally {
    expected.fill(0);
    f.keys.lock();
  }
});

test('adopted root-derived reader opens actual sealed entries and captured readers refuse after lock', async () => {
  const f = fixture();
  const expected = seed();
  try {
    await f.keys.prepareLogin()(account, expected.slice(), 15, 'localhost', pageOrigin);
    const publicKey = f.keys.snapshot().publicKey;
    assert.ok(publicKey);
    const original = recipeDeviceKeyring({
      withSession: (work) => work(),
      deviceSecret: async () => {
        throw Error('Owner key is unavailable');
      },
      deriveSecret: async (params) => deriveSymmetricSecret(expected, params),
    });
    const created = await original.createKeys(account.networkId, {
      devicePublicKey: publicKey,
      scheme: 'jubjub-schnorr',
    });
    const coin = {
      nonce: new Uint8Array(32).fill(3),
      color: new Uint8Array(32).fill(4),
      value: 7n,
    };
    const entry = await sealInboxCoin(created.encKey, coin);
    const keyring = {
      account: account.address,
      encKey: created.encKey,
      envelopes: created.envelopes,
    };
    const viewer = f.keys.viewer(context());
    assert.ok(viewer);
    assert.deepEqual(await viewer.openInbox(account.networkId, keyring, [entry]), [
      { kind: 'coin', coin },
    ]);
    await assert.rejects(viewer.openInbox('other', keyring, [entry]), /context mismatch/);
    f.keys.lock();
    await assert.rejects(
      viewer.openInbox(account.networkId, keyring, [entry]),
      /locked or expired/,
    );
  } finally {
    expected.fill(0);
    f.keys.lock();
  }
});

test('adopted routine access remains bound to account, network, binding and credential', async () => {
  const f = fixture();
  await f.keys.prepareLogin()(account, seed(), 10, 'localhost', pageOrigin);
  for (const other of [
    { ...account, address: 'cd'.repeat(32) },
    { ...account, networkId: 'other' },
    { ...account, bindingId: 'other' },
    { ...account, credentialId: Uint8Array.of(9) },
  ]) {
    assert.equal(f.keys.lease(other), undefined);
    assert.equal(f.keys.walletSeed(other), undefined);
    assert.equal(f.keys.viewer(context(other)), undefined);
    assert.equal(f.keys.ownerSession(other), undefined);
  }
  const lease = f.keys.lease(account);
  assert.ok(lease);
  lease();
  f.keys.lock();
  assert.throws(lease, /locked or expired/);
});

test('login adoption copies the incoming seed before any asynchronous pure-circuit load', async () => {
  const f = fixture();
  const gate = deferred();
  const entered = deferred();
  f.pure(async () => {
    entered.release();
    await gate.wait;
    return pureCircuits;
  });
  const supplied = seed();
  const expected = supplied.slice();
  const adoption = f.keys.prepareLogin()(account, supplied, 15, 'localhost', pageOrigin);
  await entered.wait;
  supplied.fill(0xaa);
  gate.release();
  await adoption;
  const actual = f.keys.walletSeed(account);
  assert.ok(actual);
  assert.deepEqual(actual, expected);
  assert.ok(zeroed(supplied));
  actual.fill(0);
  expected.fill(0);
  f.keys.lock();
});

for (const boundary of [
  'lock before adoption',
  'lock during pure',
  'expired during pure',
  'pure failure',
] as const) {
  test(`login adoption fails closed and clears supplied material at ${boundary}`, async () => {
    const f = fixture();
    const gate = deferred();
    const entered = deferred();
    f.pure(async () => {
      entered.release();
      await gate.wait;
      if (boundary === 'pure failure') throw Error('Circuit loader unavailable');
      return pureCircuits;
    });
    const adopt = f.keys.prepareLogin();
    const supplied = seed();
    if (boundary === 'lock before adoption') {
      f.keys.lock();
      await assert.rejects(
        adopt(account, supplied, 10, 'localhost', pageOrigin),
        /cancelled or superseded/,
      );
    } else {
      const pending = adopt(account, supplied, 10, 'localhost', pageOrigin);
      await entered.wait;
      if (boundary === 'lock during pure') f.keys.lock();
      if (boundary === 'expired during pure') f.time(2_400_000, 601_000);
      gate.release();
      await assert.rejects(pending, /cancelled|expired|Circuit loader unavailable/);
    }
    assert.ok(zeroed(supplied));
    assert.equal(f.keys.walletSeed(account), undefined);
    assert.equal(f.keys.ownerSession(account), undefined);
    assert.equal(f.unlocks(), 0);
  });
}

test('a replacement preparation supersedes an in-flight adoption without clearing the newer lease', async () => {
  const f = fixture();
  const gate = deferred();
  const entered = deferred();
  let loads = 0;
  f.pure(async () => {
    if (++loads === 1) {
      entered.release();
      await gate.wait;
    }
    return pureCircuits;
  });
  const oldSeed = seed();
  const previous = f.keys.prepareLogin()(account, oldSeed, 15, 'localhost', pageOrigin);
  await entered.wait;
  const nextAccount = { ...account, address: 'cd'.repeat(32) };
  const nextSeed = seed(8);
  await f.keys.prepareLogin()(nextAccount, nextSeed, 10, 'localhost', pageOrigin);
  gate.release();
  await assert.rejects(previous, /cancelled/);
  assert.ok(zeroed(oldSeed));
  assert.ok(zeroed(nextSeed));
  assert.equal(f.keys.matches(account), false);
  assert.equal(f.keys.matches(nextAccount), true);
  f.keys.lock();
});

for (const invalid of [
  'seed length',
  'account',
  'credential',
  'duration',
  'RP',
  'origin',
] as const) {
  test(`invalid login adoption ${invalid} rejects and zeroes its owned input`, async () => {
    const f = fixture();
    const supplied = invalid === 'seed length' ? new Uint8Array(63).fill(7) : seed();
    const target =
      invalid === 'account'
        ? { ...account, address: 'invalid' }
        : invalid === 'credential'
          ? { address: account.address, networkId: account.networkId, bindingId: account.bindingId }
          : account;
    await assert.rejects(
      f.keys.prepareLogin()(
        target,
        supplied,
        invalid === 'duration' ? 20 : 15,
        invalid === 'RP' ? '' : 'localhost',
        invalid === 'origin' ? '' : pageOrigin,
      ),
    );
    assert.ok(zeroed(supplied));
    assert.equal(f.keys.walletSeed(account), undefined);
    assert.equal(f.unlocks(), 0);
  });
}

test('adopted leases retain absolute expiry and never grow after routine reads', async () => {
  const f = fixture();
  await f.keys.prepareLogin()(account, seed(), 10, 'localhost', pageOrigin);
  const expiresAt = f.keys.snapshot().expiresAt;
  const lease = f.keys.lease(account);
  assert.ok(lease);
  f.time(1_900_000, 101_000);
  f.keys.walletSeed(account)?.fill(0);
  lease();
  assert.equal(f.keys.snapshot().expiresAt, expiresAt);
  f.time(2_400_000, 601_000);
  assert.throws(lease, /locked or expired/);
  assert.equal(f.keys.snapshot().status, 'expired');
});
