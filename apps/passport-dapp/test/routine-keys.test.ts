import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pureCircuits } from '#acc';
import {
  recipeDeviceKeyring,
  seedFromRoot,
  deriveSymmetricSecret,
  type JubjubDeviceCircuits,
} from '@input-output-hk/mn-passport-keys';
import { createRoutineKeys, type RoutineAccount } from '../src/routine-keys.js';

const account: RoutineAccount = {
  address: 'ab'.repeat(32),
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  credentialId: Uint8Array.of(1, 2),
};
function fixture() {
  let wall = 1_800_000,
    monotonic = 1000,
    unlocks = 0;
  const outputs: { root: Uint8Array; authoriser: Uint8Array }[] = [];
  let wait: (() => Promise<void>) | undefined;
  const keys = createRoutineKeys({
    now: () => wall,
    monotonic: () => monotonic,
    pure: async () => pureCircuits as JubjubDeviceCircuits,
    async unlock() {
      unlocks++;
      await wait?.();
      const output = { root: new Uint8Array(32).fill(9), authoriser: new Uint8Array(32).fill(7) };
      outputs.push(output);
      return output;
    },
  });
  return {
    keys,
    outputs,
    unlocks: () => unlocks,
    time(w: number, m: number) {
      wall = w;
      monotonic = m;
    },
    hold(fn: () => Promise<void>) {
      wait = fn;
    },
  };
}
const context = () => ({
  account: account.address,
  networkId: account.networkId,
  bindingId: account.bindingId,
  credentialId: account.credentialId!.slice(),
});
const session = (sessionId = '12'.repeat(32)) => ({
  ...context(),
  origin: 'localhost',
  sessionId,
  expiresAt: 1_800_000 + 10 * 60_000,
});

test('one explicit PRF unlock derives a JubJub pair and reuses the same wallet identity without retaining PRF owner output', async () => {
  const f = fixture();
  const expected = seedFromRoot(new Uint8Array(32).fill(9));
  await f.keys.unlock(account, 15, 'localhost', 'http://localhost:5173');
  assert.match(f.keys.snapshot().publicKey!, /^[0-9a-f]{64}$/);
  assert.equal(f.unlocks(), 1);
  assert.ok(
    f.outputs.every((o) => o.root.every((b) => b === 0) && o.authoriser.every((b) => b === 0)),
  );
  const first = f.keys.walletSeed(account)!;
  assert.deepEqual(first, expected);
  first.fill(0);
  const second = f.keys.walletSeed(account)!;
  assert.deepEqual(second, expected);
  second.fill(0);
  expected.fill(0);
  for (const other of [
    { ...account, address: 'cd'.repeat(32) },
    { ...account, networkId: 'other' },
    { ...account, bindingId: 'other' },
    { ...account, credentialId: Uint8Array.of(3) },
  ]) {
    assert.equal(f.keys.walletSeed(other), undefined);
    assert.equal(
      f.keys.viewer({
        account: other.address,
        networkId: other.networkId,
        bindingId: other.bindingId,
        credentialId: other.credentialId!,
      }),
      undefined,
    );
  }
  f.keys.lock();
});

test('real device envelopes open with the bounded reader; another account and a locked captured reader refuse', async () => {
  const f = fixture();
  await f.keys.unlock(account, 15, 'localhost', 'http://localhost:5173');
  const seed = seedFromRoot(new Uint8Array(32).fill(9));
  const original = recipeDeviceKeyring({
    withSession: (work) => work(),
    deviceSecret: async () => {
      throw Error('owner unavailable');
    },
    deriveSecret: async (p) => deriveSymmetricSecret(seed, p),
  });
  const created = await original.createKeys(account.networkId, {
    devicePublicKey: f.keys.snapshot().publicKey!,
    scheme: 'jubjub-schnorr',
  });
  const keys = { account: account.address, encKey: created.encKey, envelopes: created.envelopes };
  const viewer = f.keys.viewer(context())!;
  assert.deepEqual(await viewer.openInbox(account.networkId, keys, []), []);
  await assert.rejects(
    viewer.openInbox(account.networkId, { ...keys, account: 'cd'.repeat(32) }, []),
    /context mismatch/,
  );
  f.keys.lock();
  await assert.rejects(viewer.openInbox(account.networkId, keys, []), /locked or expired/);
  seed.fill(0);
});

test('a captured review lease refuses expiry and cannot revive after another unlock of the same account', async () => {
  const f = fixture();
  assert.equal(f.keys.lease(account), undefined);
  await f.keys.unlock(account, 10, 'localhost', 'http://localhost:5173');
  const reviewed = f.keys.lease(account)!;
  reviewed();
  f.time(1_800_000 + 10 * 60_000, 1000);
  assert.throws(reviewed, /locked or expired/);
  await f.keys.unlock(account, 15, 'localhost', 'http://localhost:5173');
  assert.throws(reviewed, /locked or expired/);
  f.keys.lease(account)!();
  f.keys.lock();
});

test('grant children reuse the unlock but remain distinct and cannot sign owner calls or survive local lock', async () => {
  const f = fixture();
  await f.keys.unlock(account, 15, 'localhost', 'http://localhost:5173');
  const a = (await f.keys.sessionKey(account, session()))!;
  const b = (await f.keys.sessionKey(account, session('34'.repeat(32))))!;
  assert.notEqual(a.publicKey, b.publicKey);
  assert.equal(f.unlocks(), 1);
  await assert.rejects(
    a.authoriser.authorise({
      account: account.address,
      circuit: 'rotate_enc_key_with_jubjub',
    } as never),
    /owner operation/,
  );
  await assert.rejects(
    f.keys.sessionKey(account, { ...session(), origin: 'https://other.test' }),
    /context mismatch/,
  );
  f.keys.lock();
  await assert.rejects(a.authoriser.devicePublicKeyHex!(), /locked or expired/);
  assert.equal(f.keys.walletSeed(account), undefined);
});

for (const [name, wall, mono] of [
  ['absolute expiry', 2_700_000, 2000],
  ['monotonic expiry', 1_800_001, 901_000],
  ['wall rollback', 1_799_999, 1001],
  ['monotonic rollback', 1_800_001, 999],
] as const) {
  test(`quick actions fail closed at ${name}`, async () => {
    const f = fixture();
    await f.keys.unlock(account, 15, 'localhost', 'http://localhost:5173');
    f.time(wall, mono);
    assert.equal(f.keys.walletSeed(account), undefined);
    assert.equal(f.keys.snapshot().status, 'expired');
  });
}

test('a retained grant signer checks the shorter local lease without relying on its timer', async () => {
  const f = fixture();
  await f.keys.unlock(account, 10, 'localhost', 'http://localhost:5173');
  const key = (await f.keys.sessionKey(account, {
    ...session(),
    expiresAt: 1_800_000 + 20 * 60_000,
  }))!;
  f.time(1_800_001, 601_001);
  await assert.rejects(key.authoriser.devicePublicKeyHex!(), /locked or expired/);
  assert.equal(f.keys.snapshot().status, 'expired');
});

test('a late PRF result cannot reinstall a lease after lock and its outputs are zeroed', async () => {
  const f = fixture();
  let release!: () => void;
  const pending = new Promise<void>((r) => {
    release = r;
  });
  f.hold(() => pending);
  const unlock = f.keys.unlock(account, 15, 'localhost', 'http://localhost:5173');
  while (!f.unlocks()) await new Promise<void>((resolve) => setImmediate(resolve));
  f.keys.lock();
  release();
  await assert.rejects(unlock, /cancelled/);
  assert.equal(f.keys.snapshot().status, 'locked');
  assert.equal(f.outputs.length, 1, 'the actual delayed PRF output must be observed and erased');
  assert.ok(
    f.outputs.every((o) => o.root.every((b) => b === 0) && o.authoriser.every((b) => b === 0)),
  );
});

test('full authentication reproduces the same owner and disposes its previous generation on renewal and expiry', async () => {
  const f = fixture();
  await f.keys.unlock(account, 10, 'localhost', 'http://localhost:5173', true);
  const first = f.keys.ownerSession(account)!;
  const publicKey = first.publicKey;
  f.keys.verifyOwner(account);
  assert.equal(f.keys.snapshot().ownerVerified, true);
  await f.keys.unlock(account, 15, 'localhost', 'http://localhost:5173', true);
  assert.equal(f.keys.ownerSession(account)!.publicKey, publicKey);
  await assert.rejects(first.authoriser.devicePublicKey(), /locked/);
  const current = f.keys.ownerSession(account)!;
  f.time(1_800_001, 901_001);
  await assert.rejects(current.authoriser.devicePublicKey(), /locked or expired/);
  assert.equal(f.keys.ownerSession(account), undefined);
  assert.ok(
    f.outputs.every((o) => o.root.every((b) => b === 0) && o.authoriser.every((b) => b === 0)),
  );
});

test('a failing routine observer cannot interrupt key disposal or later observers', async () => {
  const f = fixture();
  let fail = false,
    notified = false;
  f.keys.subscribe(() => {
    if (fail) throw Error('storage observer');
  });
  f.keys.subscribe(() => {
    if (fail) notified = true;
  });
  await f.keys.unlock(account, 15, 'localhost', 'http://localhost:5173', true);
  const owner = f.keys.ownerSession(account)!;
  fail = true;
  assert.doesNotThrow(() => f.keys.lock());
  assert.equal(notified, true);
  assert.throws(() => owner.check(), /locked/);
});
