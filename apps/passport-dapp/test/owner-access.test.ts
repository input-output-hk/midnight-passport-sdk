import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import type { AuthenticatedJubjubOwner } from '@input-output-hk/mn-passport-keys';
import { authenticateOwnerAccount, routeAuthenticatedAccount } from '../src/owner-access.js';

function fixture() {
  let active = true,
    live = false,
    sends = 0,
    confirmations = 0;
  const entries = new Map<string, string>();
  const primary = {
    address: 'ab'.repeat(32),
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    scheme: 'p256-webauthn',
    addDevice: async () => {
      sends++;
      live = true;
      return { txHash: 'tx-1', commitmentHex: 'cd'.repeat(32) };
    },
  } as unknown as PassportAccount;
  const authenticated = { ...primary, scheme: 'jubjub-schnorr' } as PassportAccount;
  const owner = {
    context: {
      account: primary.address,
      networkId: primary.networkId,
      bindingId: primary.bindingId,
      credentialId: Uint8Array.of(1),
    },
    publicKey: '12'.repeat(32),
    readerPublicKey: '34'.repeat(32),
    check() {
      if (!active) throw Error('locked');
    },
  } as AuthenticatedJubjubOwner;
  const input = {
    primary,
    owner,
    async open() {
      if (!live) throw Object.assign(Error('not enrolled'), { code: 'NotAuthorised' });
      return authenticated;
    },
    async confirm() {
      confirmations++;
      return true;
    },
    storage: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => {
        entries.set(key, value);
      },
    },
    trace() {},
  };
  return {
    input,
    primary,
    authenticated,
    entries,
    lock: () => {
      active = false;
    },
    setLive: () => {
      live = true;
    },
    sends: () => sends,
    confirmations: () => confirmations,
  };
}
test('first owner activation reviews and enrolls once, then verifies; reauthentication only verifies', async () => {
  const f = fixture();
  assert.equal(await authenticateOwnerAccount(f.input), f.authenticated);
  assert.equal(f.sends(), 1);
  assert.equal(f.confirmations(), 1);
  assert.equal(JSON.parse([...f.entries.values()][0]!).state, 'verified');
  await authenticateOwnerAccount(f.input);
  assert.equal(f.sends(), 1);
  assert.equal(f.confirmations(), 1);
});
test('decline and stale lease cannot send; unresolved enrollment cannot be replaced', async () => {
  const declined = fixture();
  await assert.rejects(
    authenticateOwnerAccount({ ...declined.input, confirm: async () => false }),
    /declined/,
  );
  assert.equal(declined.sends(), 0);
  const stale = fixture();
  stale.lock();
  await assert.rejects(authenticateOwnerAccount(stale.input), /locked/);
  assert.equal(stale.sends(), 0);
  const uncertain = fixture();
  uncertain.input.primary.addDevice = async () => {
    throw Error('submission unknown');
  };
  await assert.rejects(authenticateOwnerAccount(uncertain.input), /submission unknown/);
  await assert.rejects(authenticateOwnerAccount(uncertain.input), /reconciliation/);
  assert.equal(uncertain.sends(), 0);
});
test('routed methods use the authenticated owner for administration and never fall back after lease loss', async () => {
  let selected: PassportAccount | undefined;
  let reviewed = true;
  const calls: string[] = [];
  const primary = {
    rotateViewingKey: async () => {
      calls.push('passkey');
    },
  } as unknown as PassportAccount;
  const owner = {
    rotateViewingKey: async () => {
      calls.push('jubjub');
    },
  } as unknown as PassportAccount;
  const account = routeAuthenticatedAccount(
    primary,
    () => selected,
    () => {
      if (!reviewed) throw Error('expired');
    },
  );
  selected = owner;
  await account.rotateViewingKey!();
  assert.deepEqual(calls, ['jubjub']);
  const captured = account.rotateViewingKey!;
  selected = undefined;
  reviewed = false;
  assert.throws(() => captured(), /expired/);
  assert.deepEqual(calls, ['jubjub']);
});

test('a submitted enrollment with a lost response reconciles through live opening without another send', async () => {
  const f = fixture();
  let sends = 0;
  f.input.primary.addDevice = async () => {
    sends++;
    f.setLive();
    throw Error('lost response');
  };
  await assert.rejects(authenticateOwnerAccount(f.input), /lost response/);
  const [name, raw] = [...f.entries.entries()][0]!;
  const pending = JSON.parse(raw);
  assert.equal(pending.state, 'pending');
  f.entries.set(name, JSON.stringify({ ...pending, unapprovedField: 'discard' }));
  assert.equal(await authenticateOwnerAccount(f.input), f.authenticated);
  const reconciled = JSON.parse(f.entries.get(name)!);
  assert.equal(reconciled.state, 'verified');
  assert.equal(reconciled.attemptId, pending.attemptId);
  assert.equal(reconciled.unapprovedField, undefined);
  assert.equal(sends, 1);
});

test('public receipt reconciliation reads survive lease loss without authorising another owner action', async () => {
  let valid = true;
  let selected: PassportAccount | undefined;
  const reads: string[] = [];
  const primary = {
    state: async () => {
      reads.push('state');
      return { authNonce: 2n };
    },
    deviceRoster: async () => {
      reads.push('devices');
      return {};
    },
    grantRoster: async () => {
      reads.push('grants');
      return {};
    },
    rotateViewingKey: async () => {
      throw Error('no passkey fallback');
    },
  } as unknown as PassportAccount;
  selected = {
    rotateViewingKey: async () => {
      valid = false;
      selected = undefined;
      return { txHash: 'ab'.repeat(32) };
    },
  } as unknown as PassportAccount;
  const routed = routeAuthenticatedAccount(
    primary,
    () => selected,
    () => {
      if (!valid) throw Error('expired');
    },
  );
  const receipt = await routed.rotateViewingKey!();
  await routed.state();
  await routed.deviceRoster!();
  await routed.grantRoster!();
  assert.equal(receipt.txHash, 'ab'.repeat(32));
  assert.deepEqual(reads, ['state', 'devices', 'grants']);
  assert.throws(() => routed.rotateViewingKey!(), /expired/);
});

test('companion enrollment retains its rotation reference after verification failure and reconciliation', async () => {
  const f = fixture();
  f.input.primary.addDevice = async () => ({
    txHash: 'enrollment-id',
    nextUseCounter: 1n,
    rotationTxHash: 'rotation-id',
    commitmentHex: 'cd'.repeat(32),
  });
  await assert.rejects(authenticateOwnerAccount(f.input), /not enrolled/);
  let record = JSON.parse([...f.entries.values()][0]!);
  assert.equal(record.txHash, 'enrollment-id');
  assert.equal(record.rotationTxHash, 'rotation-id');
  f.setLive();
  await authenticateOwnerAccount(f.input);
  record = JSON.parse([...f.entries.values()][0]!);
  assert.equal(record.state, 'verified');
  assert.equal(record.rotationTxHash, 'rotation-id');
});
