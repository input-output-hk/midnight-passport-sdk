import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PassportAccount, GrantScopeInput } from '@input-output-hk/mn-passport-protocol';
import { createDemoSession, type DemoSessionPorts } from '../src/session.ts';
import { sessionCheckpoint } from '../src/session-checkpoint.ts';
import type { GrantHandoff } from '../src/grant-handoff.ts';

const scope = {
  operations: ['withdraw-unshielded'] as const,
  color: '00'.repeat(32),
  recipient: { kind: 'user-address' as const, value: '56'.repeat(32) },
  maxCoinValue: '5',
  perCallCap: '2',
  cap: '5',
};
const transfer = { color: scope.color, recipient: scope.recipient.value, amount: '1' };
function fixture() {
  let wall = 1_800_000,
    mono = 1000,
    disposed = 0,
    issues = 0,
    spends = 0,
    revokes = 0;
  let issuedScope: GrantScopeInput;
  let holdUnlock: (() => Promise<void>) | undefined;
  let holdSpend: (() => Promise<void>) | undefined;
  let failSpend = false,
    failOpening = false,
    failIssue = false;
  const account = {
    address: '12'.repeat(32),
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    scheme: 'p256-webauthn',
    credentialId: Uint8Array.of(1),
    async issueGrant(s: GrantScopeInput) {
      issues++;
      issuedScope = s;
      if (failIssue) throw Error('original issue unknown');
      return { grantId: '34'.repeat(32), txHash: 'ab'.repeat(32) };
    },
    async revokeGrant() {
      revokes++;
      return { txHash: 'cd'.repeat(32) };
    },
  } as unknown as PassportAccount;
  const key = {
    publicKey: '78'.repeat(32),
    authoriser: {} as never,
    dispose: () => {
      disposed++;
    },
  };
  const ports: DemoSessionPorts = {
    now: () => wall,
    monotonic: () => mono,
    unlock: async () => {
      await holdUnlock?.();
      return key;
    },
    opening: async () => {
      if (failOpening) throw Error('opening unknown');
      return {
        kind: 'mn-passport-unshielded-grant-v1',
        account: account.address,
        networkId: account.networkId,
        bindingId: 'acc-s3r1.1',
        grantId: '34'.repeat(32),
        granteePublicKey: key.publicKey,
        origin: 'localhost',
        slot: 0,
        scopeSalt: '9a'.repeat(32),
        color: scope.color,
        recipient: scope.recipient.value,
        maxCoinValue: scope.maxCoinValue,
        perCallCap: scope.perCallCap,
        cap: scope.cap,
        expiresAt: issuedScope.expiresAt!,
      } as GrantHandoff;
    },
    spend: async (_o, _k, amount, spent) => {
      spends++;
      await holdSpend?.();
      if (failSpend) throw Error('original spend unknown');
      return { txHash: 'ef'.repeat(32), spentTotal: BigInt(amount) + BigInt(spent) };
    },
    changed: () => {},
  };
  const session = createDemoSession(ports);
  return {
    session,
    account,
    ports,
    start: () => session.start(account, scope, 15, 'localhost'),
    setTime: (w: number, m: number) => {
      wall = w;
      mono = m;
    },
    counters: () => ({ disposed, issues, spends, revokes }),
    setUnlock: (f: () => Promise<void>) => {
      holdUnlock = f;
    },
    setSpend: (f: () => Promise<void>) => {
      holdSpend = f;
    },
    failSpend: () => {
      failSpend = true;
    },
    failOpening: () => {
      failOpening = true;
    },
    failIssue: () => {
      failIssue = true;
    },
  };
}

test('bounded session enforces account/network/binding/asset/recipient and caps with no owner fallback', async () => {
  const f = fixture();
  await f.start();
  assert.equal(f.session.snapshot().status, 'active');
  assert.equal(f.session.snapshot().expiresAt, 2_700_000);
  assert.ok(f.session.matches(f.account, transfer));
  for (const other of [
    { address: 'aa'.repeat(32) },
    { networkId: 'preview' },
    { bindingId: 'other' },
  ])
    assert.equal(f.session.matches({ ...f.account, ...other }, transfer), false);
  for (const other of [
    { color: 'aa'.repeat(32) },
    { recipient: 'aa'.repeat(32) },
    { amount: '3' },
    { amount: '0' },
    { amount: '01' },
  ])
    assert.equal(f.session.matches(f.account, { ...transfer, ...other }), false);
  for (let i = 0; i < 5; i++) await f.session.spend(f.account, transfer);
  assert.equal(f.session.matches(f.account, transfer), false);
  assert.equal(f.session.snapshot().spent, '5');
  await assert.rejects(f.session.spend(f.account, transfer), /outside/);
  assert.equal(f.counters().spends, 5);
});

test('absolute wall/monotonic expiry and clock rollback lock and cannot silently renew', async () => {
  for (const [wall, mono] of [
    [2_700_000, 1000],
    [1_800_000, 901000],
    [1_799_999, 1000],
    [1_800_000, 999],
  ]) {
    const f = fixture();
    await f.start();
    f.setTime(wall!, mono!);
    assert.equal(f.session.snapshot().status, 'expired');
    assert.equal(f.session.matches(f.account, transfer), false);
    await assert.rejects(f.start(), /Revoke/);
    assert.equal(f.counters().disposed, 1);
  }
  for (const minutes of [0, 9, 31, NaN, 15.5]) {
    const f = fixture();
    await assert.rejects(f.session.start(f.account, scope, minutes, 'localhost'), /between/);
    assert.equal(f.counters().issues, 0);
  }
});

test('lock during unlock disposes the late key and issues nothing; sessions do not survive recreation', async () => {
  const f = fixture();
  let release!: () => void;
  f.setUnlock(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  const starting = f.start();
  await assert.rejects(f.start(), /already running/);
  f.session.lock();
  release();
  await assert.rejects(starting, /cancelled/);
  assert.equal(f.counters().issues, 0);
  assert.equal(f.counters().disposed, 1);
  assert.equal(createDemoSession(f.ports).snapshot().status, 'locked');
});

test('concurrent spend refuses; confirmed effect after local lock remains recorded', async () => {
  const f = fixture();
  await f.start();
  let release!: () => void;
  f.setSpend(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  const spending = f.session.spend(f.account, transfer);
  await assert.rejects(f.session.spend(f.account, transfer), /already running/);
  f.session.lock();
  release();
  await spending;
  assert.equal(f.session.snapshot().status, 'locked');
  assert.equal(f.session.snapshot().spent, '1');
  assert.equal(f.counters().spends, 1);
});

test('uncertain spend, issue or post-issue opening blocks another grant or spend until reconciliation', async () => {
  for (const boundary of ['spend', 'issue', 'opening']) {
    const f = fixture();
    if (boundary === 'spend') {
      await f.start();
      f.failSpend();
      await assert.rejects(f.session.spend(f.account, transfer), /unknown/);
    } else {
      if (boundary === 'issue') f.failIssue();
      else f.failOpening();
      await assert.rejects(f.start(), /unknown/);
    }
    assert.equal(f.session.snapshot().status, 'blocked');
    f.session.lock();
    assert.equal(f.session.snapshot().status, 'blocked');
    await assert.rejects(f.start(), /Revoke/);
    await assert.rejects(f.session.spend(f.account, transfer), /outside/);
  }
});

test('revocation requires the issuing owner and clears the old grant only after confirmation', async () => {
  const f = fixture();
  await f.start();
  f.session.lock();
  await assert.rejects(f.session.revoke({ ...f.account, address: 'ff'.repeat(32) }), /issuing/);
  await f.session.revoke(f.account);
  assert.equal(f.counters().revokes, 1);
  assert.equal(f.session.snapshot().status, 'revoked');
  await f.start();
  assert.equal(f.counters().issues, 2);
});

test('scope substitution after issue is refused and leaves the original grant identifiable', async () => {
  const f = fixture();
  const original = f.ports.opening;
  (f.ports as { opening: DemoSessionPorts['opening'] }).opening = async (a, g) => ({
    ...(await original(a, g)),
    cap: '99',
  });
  await assert.rejects(f.start(), /differs/);
  assert.equal(f.session.snapshot().status, 'blocked');
  assert.equal(f.session.snapshot().grantId, '34'.repeat(32));
});

test('reload keeps public grant identity, locks active sessions and fences interrupted sends', async () => {
  const memory = new Map<string, string>();
  const checkpoint = sessionCheckpoint(
    {
      getItem: (k) => memory.get(k) ?? null,
      setItem: (k, v) => {
        memory.set(k, v);
      },
    },
    'undeployed',
    'acc-s3r1.1',
  );
  const f = fixture();
  (f.ports as { checkpoint: typeof checkpoint }).checkpoint = checkpoint;
  const session = createDemoSession(f.ports);
  await session.start(f.account, scope, 15, 'localhost');
  const reloaded = createDemoSession(f.ports);
  assert.equal(reloaded.snapshot().status, 'locked');
  assert.equal(reloaded.snapshot().grantId, '34'.repeat(32));
  assert.equal(reloaded.matches(f.account, transfer), false);
  let release!: () => void;
  f.setSpend(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  const pending = session.spend(f.account, transfer);
  session.lock();
  assert.equal(createDemoSession(f.ports).snapshot().status, 'blocked');
  release();
  await pending;
  assert.equal(
    createDemoSession(f.ports).snapshot().status,
    'locked',
    'confirmed result resolves the local interruption fence',
  );
  for (const text of memory.values())
    assert.doesNotMatch(text, /scopeSalt|sessionId|authoriser|secret|seed/);
});

test('malformed public checkpoints fail closed and writes cannot persist key fields', () => {
  let saved = '{"status":"active","spent":"0","privateKey":"bad"}';
  const checkpoint = sessionCheckpoint(
    {
      getItem: () => saved,
      setItem: (_k, v) => {
        saved = v;
      },
    },
    'undeployed',
    'acc-s3r1.1',
  );
  assert.equal(checkpoint.read()!.status, 'blocked');
  checkpoint.write({ status: 'locked', spent: '0', privateKey: 'bad' } as never);
  assert.doesNotMatch(saved, /privateKey/);
});

test('expiry while a send is pending retains an uncertainty fence until its original result settles', async () => {
  const f = fixture();
  await f.start();
  let release!: () => void;
  f.setSpend(
    () =>
      new Promise<void>((r) => {
        release = r;
      }),
  );
  const sending = f.session.spend(f.account, transfer);
  f.setTime(2_700_000, 901_000);
  assert.equal(f.session.snapshot().status, 'blocked');
  await assert.rejects(f.start(), /already running/);
  release();
  await sending;
  assert.equal(f.session.snapshot().status, 'locked');
  assert.equal(f.session.snapshot().spent, '1');
});
