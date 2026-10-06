import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  sponsorPolicy,
  viewOfLedgerTx,
  type ActionClasses,
  type ActionView,
  type LedgerTxLike,
  type SponsorTxView,
} from '../src/sponsor-policy.ts';

const ADDR = 'ab'.repeat(32);
const allowed = new Set([ADDR]);
const call = (address: string = ADDR): ActionView => ({ kind: 'call', address });
const DUST = { tag: 'dust' };
const UNSHIELDED = { tag: 'unshielded' };
const SHIELDED = { tag: 'shielded' };

function view(
  over: Partial<SponsorTxView> & { imbalance?: Record<number, [{ tag: string }, bigint][]> } = {},
): SponsorTxView {
  const { imbalance = {}, ...rest } = over;
  return {
    intents: new Map([[1, { actions: [call()] }]]),
    segments: [0, 1],
    imbalances: (segment) => new Map(imbalance[segment] ?? []),
    ...rest,
  };
}

test('a fee-only call to a sponsored account is allowed, a dust deficit included', () => {
  assert.equal(sponsorPolicy(view(), allowed), undefined);
  assert.equal(
    sponsorPolicy(view({ imbalance: { 0: [[DUST, -5000n]], 1: [[DUST, 0n]] } }), allowed),
    undefined,
  );
});

test('an unshielded imbalance in segment 0 is refused', () => {
  assert.match(
    sponsorPolicy(view({ imbalance: { 0: [[UNSHIELDED, -1n]] } }), allowed) ?? '',
    /unshielded value in segment 0/,
  );
  // A surplus is refused too: the sponsor funds nothing but fees.
  assert.match(
    sponsorPolicy(view({ imbalance: { 0: [[UNSHIELDED, 1n]] } }), allowed) ?? '',
    /unshielded/,
  );
});

test('a shielded imbalance in a fallible segment is refused', () => {
  assert.match(
    sponsorPolicy(view({ segments: [0, 1, 2], imbalance: { 2: [[SHIELDED, -7n]] } }), allowed) ??
      '',
    /shielded value in segment 2/,
  );
});

test('an imbalance that cannot be computed is refused', () => {
  const v = view({
    imbalances: () => {
      throw new Error('invalid segment');
    },
  });
  assert.match(sponsorPolicy(v, allowed) ?? '', /cannot be computed/);
});

test('deploy and maintenance actions are refused', () => {
  for (const kind of ['deploy', 'maintenance', 'other'] as const) {
    const v = view({ intents: new Map([[1, { actions: [call(), { kind }] }]]) });
    assert.match(sponsorPolicy(v, allowed) ?? '', new RegExp(`${kind} actions`));
  }
});

test('a call to an unregistered address is refused', () => {
  assert.match(
    sponsorPolicy(
      view({ intents: new Map([[1, { actions: [call('cd'.repeat(32))] }]]) }),
      allowed,
    ) ?? '',
    /not to a Passport account/,
  );
  assert.match(
    sponsorPolicy(view({ intents: new Map([[1, { actions: [{ kind: 'call' }] }]]) }), allowed) ??
      '',
    /not to a Passport account/,
  );
  // One good call does not excuse a second, bad one.
  const two = view({ intents: new Map([[1, { actions: [call(), call('cd'.repeat(32))] }]]) });
  assert.match(sponsorPolicy(two, allowed) ?? '', /not to a Passport account/);
});

test('a transaction with no intents or no contract calls is refused', () => {
  const { intents: _drop, ...bare } = view();
  assert.match(sponsorPolicy(bare, allowed) ?? '', /no intents/);
  assert.match(sponsorPolicy(view({ intents: new Map() }), allowed) ?? '', /no intents/);
  assert.match(
    sponsorPolicy(view({ intents: new Map([[1, { actions: [] }]]) }), allowed) ?? '',
    /no contract calls/,
  );
});

test('a rewards transaction is refused', () => {
  assert.match(sponsorPolicy(view({ rewards: {} }), allowed) ?? '', /rewards/);
});

test('an uppercase call address is normalised and allowed', () => {
  const upper = view({ intents: new Map([[1, { actions: [call(ADDR.toUpperCase())] }]]) });
  assert.equal(sponsorPolicy(upper, allowed), undefined);
});

class FakeCall {
  entryPoint = 'x';
  constructor(readonly address: string) {}
}
class FakeDeploy {}
class FakeUpdate {}
const classes: ActionClasses = {
  ContractCall: FakeCall,
  ContractDeploy: FakeDeploy,
  MaintenanceUpdate: FakeUpdate,
};

test('the ledger adapter classifies actions and collects every segment', () => {
  const tx: LedgerTxLike = {
    rewards: undefined,
    intents: new Map([
      [1, { actions: [new FakeCall(ADDR), new FakeDeploy(), new FakeUpdate(), {}] }],
    ]),
    fallibleOffer: new Map([[3, {}]]),
    imbalances: () => new Map(),
  };
  const v = viewOfLedgerTx(tx, classes);
  assert.deepEqual([...v.segments].sort(), [0, 1, 3]);
  assert.deepEqual(v.intents?.get(1)?.actions, [
    { kind: 'call', address: ADDR },
    { kind: 'deploy' },
    { kind: 'maintenance' },
    { kind: 'other' },
  ]);
  // The structural fallback recognises a call from another copy of the module.
  const foreign = viewOfLedgerTx(
    { ...tx, intents: new Map([[1, { actions: [{ entryPoint: 'y', address: ADDR }] }]]) },
    classes,
  );
  assert.deepEqual(foreign.intents?.get(1)?.actions, [{ kind: 'call', address: ADDR }]);
});

// The real ledger lives in the contract tree, not in this workspace.
const contractDir = process.env.PASSPORT_CONTRACT_DIR;
const ledgerPath = (() => {
  if (!contractDir) return undefined;
  try {
    return createRequire(join(contractDir, 'package.json')).resolve('@midnightntwrk/ledger-v9');
  } catch {
    return undefined;
  }
})();

test(
  'the real ledger: a transaction that moves unshielded value is refused',
  { skip: ledgerPath ? false : 'set PASSPORT_CONTRACT_DIR to a fetched contract tree to run this' },
  async () => {
    const ledger = (await import(pathToFileURL(ledgerPath!).href)) as {
      Transaction: {
        fromParts(
          network: string,
          g?: unknown,
          f?: unknown,
          intent?: unknown,
        ): { serialize(): Uint8Array };
        deserialize(s: string, p: string, b: string, raw: Uint8Array): LedgerTxLike;
      };
      Intent: { new: (ttl: Date) => { guaranteedUnshieldedOffer: unknown } };
      UnshieldedOffer: { new: (inputs: unknown[], outputs: unknown[], sigs: unknown[]) => unknown };
    } & ActionClasses;
    const intent = ledger.Intent.new(new Date(Date.now() + 60_000));
    intent.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
      [],
      [{ value: 5n, owner: '11'.repeat(32), type: '22'.repeat(32) }],
      [],
    );
    const bytes = ledger.Transaction.fromParts(
      'undeployed',
      undefined,
      undefined,
      intent,
    ).serialize();
    const tx = ledger.Transaction.deserialize('signature', 'pre-proof', 'pre-binding', bytes);
    const v = viewOfLedgerTx(tx, ledger);
    assert.ok(v.segments.length >= 2, `segments ${v.segments.join(',')}`);
    // As built it has no contract call, so the policy refuses it for that.
    assert.match(sponsorPolicy(v, allowed) ?? '', /no contract calls/);
    // With a sponsored call grafted on, only the real imbalances can refuse it.
    const withCall: SponsorTxView = { ...v, intents: new Map([[1, { actions: [call()] }]]) };
    assert.match(sponsorPolicy(withCall, allowed) ?? '', /moves unshielded value/);
  },
);
