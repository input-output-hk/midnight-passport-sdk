import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pureCircuits } from '#acc';
import type { JubjubDeviceCircuits } from '@input-output-hk/mn-passport-keys';
import { createRoutineKeys, type RoutineAccount } from '../src/routine-keys.js';
import { verifyCriticalOwner } from '../src/critical-approval.js';

const accountFor = (scheme: 'p256-webauthn' | 'jubjub-schnorr'): RoutineAccount => ({
  address: 'ab'.repeat(32),
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  credentialId: Uint8Array.of(1, 2, 3),
  scheme,
});
const material = () => ({
  authoriser: new Uint8Array(32).fill(7),
  root: new Uint8Array(32).fill(9),
});
const zeroed = (value: Uint8Array) => value.every((byte) => byte === 0);
function deferred() {
  let release: () => void = () => {};
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}
async function fixture(scheme: 'p256-webauthn' | 'jubjub-schnorr' = 'p256-webauthn') {
  let wall = 1_800_000;
  let monotonic = 1000;
  const account = accountFor(scheme);
  const keys = createRoutineKeys({
    now: () => wall,
    monotonic: () => monotonic,
    pure: async () => pureCircuits,
    unlock: async () => material(),
  });
  await keys.unlock(account, 10, 'localhost', 'http://localhost:5173', true);
  keys.verifyOwner(account);
  const owner = keys.ownerSession(account);
  const lease = keys.lease(account);
  assert.ok(owner);
  assert.ok(lease);
  const outputs: ReturnType<typeof material>[] = [];
  let unlocks = 0;
  let loadPure = async (): Promise<JubjubDeviceCircuits> => pureCircuits;
  let unlock = async () => material();
  return {
    account,
    keys,
    owner,
    lease,
    outputs,
    input: {
      account,
      owner,
      check: lease,
      pure: () => loadPure(),
      async unlock() {
        unlocks++;
        const value = await unlock();
        outputs.push(value);
        return value;
      },
    },
    unlocks: () => unlocks,
    fresh(load: () => Promise<ReturnType<typeof material>>) {
      unlock = load;
    },
    pure(load: () => Promise<JubjubDeviceCircuits>) {
      loadPure = load;
    },
    time(w: number, m: number) {
      wall = w;
      monotonic = m;
    },
  };
}

for (const scheme of ['p256-webauthn', 'jubjub-schnorr'] as const) {
  test(`${scheme} fresh critical approval verifies real owner and reader without replacing or extending the lease`, async () => {
    const f = await fixture(scheme);
    const before = f.keys.snapshot();
    let effects = 0;
    await verifyCriticalOwner(f.input);
    effects++;
    assert.equal(effects, 1);
    assert.equal(f.unlocks(), 1);
    assert.equal(f.keys.ownerSession(f.account), f.owner);
    assert.deepEqual(f.keys.snapshot(), before);
    assert.equal(f.outputs.length, 1);
    assert.ok(f.outputs.every((value) => zeroed(value.authoriser) && zeroed(value.root)));
    f.time(2_400_000, 601_000);
    assert.throws(f.lease, /locked or expired/);
    assert.throws(() => f.owner.check(), /locked/);
  });
}

for (const fault of ['owner PRF', 'reader root', 'short owner PRF', 'short root'] as const) {
  test(`critical approval refuses a wrong ${fault}, erases fresh outputs and performs no effect`, async () => {
    const f = await fixture();
    f.fresh(async () => {
      const value = material();
      if (fault === 'owner PRF') value.authoriser.fill(8);
      if (fault === 'reader root') value.root.fill(8);
      if (fault === 'short owner PRF') value.authoriser = new Uint8Array(31).fill(8);
      if (fault === 'short root') value.root = new Uint8Array(31).fill(8);
      return value;
    });
    let effects = 0;
    await assert.rejects(async () => {
      await verifyCriticalOwner(f.input);
      effects++;
    });
    assert.equal(effects, 0);
    assert.equal(f.unlocks(), 1);
    assert.ok(f.outputs.every((value) => zeroed(value.authoriser) && zeroed(value.root)));
    f.lease();
    f.keys.lock();
  });
}

test('an expired reviewed lease refuses before fresh credential access', async () => {
  const f = await fixture();
  f.time(2_400_000, 601_000);
  await assert.rejects(verifyCriticalOwner(f.input), /locked or expired/);
  assert.equal(f.unlocks(), 0);
});

test('declining fresh passkey approval performs no effect and leaves the original lease unchanged', async () => {
  const f = await fixture();
  const before = f.keys.snapshot();
  f.fresh(async () => {
    throw new DOMException('Review declined', 'NotAllowedError');
  });
  let effects = 0;
  await assert.rejects(async () => {
    await verifyCriticalOwner(f.input);
    effects++;
  }, /Review declined/);
  assert.equal(effects, 0);
  assert.equal(f.unlocks(), 1);
  assert.equal(f.outputs.length, 0);
  assert.deepEqual(f.keys.snapshot(), before);
  f.keys.lock();
});

for (const stage of ['pure load', 'fresh prompt'] as const) {
  test(`critical approval refuses lease loss during ${stage} and disposes any fresh result`, async () => {
    const f = await fixture();
    const gate = deferred();
    const entered = deferred();
    if (stage === 'pure load')
      f.pure(async () => {
        entered.release();
        await gate.wait;
        return pureCircuits;
      });
    else
      f.fresh(async () => {
        entered.release();
        await gate.wait;
        return material();
      });
    let effects = 0;
    const pending = (async () => {
      await verifyCriticalOwner(f.input);
      effects++;
    })();
    await entered.wait;
    f.keys.lock();
    gate.release();
    await assert.rejects(pending, /locked or expired/);
    assert.equal(effects, 0);
    assert.equal(f.unlocks(), stage === 'pure load' ? 0 : 1);
    assert.ok(f.outputs.every((value) => zeroed(value.authoriser) && zeroed(value.root)));
  });
}

test('disposing the owner while pure circuits load refuses before prompting again', async () => {
  const f = await fixture();
  const gate = deferred();
  const entered = deferred();
  f.pure(async () => {
    entered.release();
    await gate.wait;
    return pureCircuits;
  });
  const pending = verifyCriticalOwner(f.input);
  await entered.wait;
  f.owner.dispose();
  gate.release();
  await assert.rejects(pending, /locked/);
  assert.equal(f.unlocks(), 0);
  f.keys.lock();
});

for (const changed of ['account', 'network', 'binding', 'credential'] as const) {
  test(`critical approval refuses a mismatched ${changed} before requesting credentials`, async () => {
    const f = await fixture();
    const target = {
      ...f.account,
      ...(changed === 'account' && { address: 'cd'.repeat(32) }),
      ...(changed === 'network' && { networkId: 'other' }),
      ...(changed === 'binding' && { bindingId: 'other' }),
      ...(changed === 'credential' && { credentialId: Uint8Array.of(9) }),
    };
    await assert.rejects(
      verifyCriticalOwner({ ...f.input, account: target, check() {} }),
      /context|account|credential/i,
    );
    assert.equal(f.unlocks(), 0);
    f.keys.lock();
  });
}

test('a failing circuit loader cannot request a passkey or dispose the still-valid original owner', async () => {
  const f = await fixture();
  f.pure(async () => {
    throw Error('Circuit loader unavailable');
  });
  await assert.rejects(verifyCriticalOwner(f.input), /Circuit loader unavailable/);
  assert.equal(f.unlocks(), 0);
  f.owner.check();
  f.keys.lock();
});
