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
  type LedgerIntentLike,
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

test('an unshielded offer is refused, in either section and whatever it holds', () => {
  // `{}` stands for any offer: an input-only or net-zero one, the shape of the sponsor-NIGHT theft.
  for (const section of ['guaranteedUnshieldedOffer', 'fallibleUnshieldedOffer'] as const) {
    const v = view({ intents: new Map([[1, { actions: [call()], [section]: {} }]]) });
    assert.match(sponsorPolicy(v, allowed) ?? '', /unshielded offers/, section);
  }
  // It is refused even with a zero net imbalance everywhere.
  const zeroNet = view({
    intents: new Map([
      [1, { actions: [call()], guaranteedUnshieldedOffer: { inputs: [{}], outputs: [{}] } }],
    ]),
    imbalance: { 0: [[UNSHIELDED, 0n]], 1: [[UNSHIELDED, 0n]] },
  });
  assert.match(sponsorPolicy(zeroNet, allowed) ?? '', /unshielded offers/);
});

test('a Dust registration or spend is refused', () => {
  const v = view({
    intents: new Map([[1, { actions: [call()], dustActions: { registrations: [{}] } }]]),
  });
  assert.match(sponsorPolicy(v, allowed) ?? '', /Dust actions/);
});

test('a shielded offer, guaranteed or fallible, is refused', () => {
  assert.match(sponsorPolicy(view({ guaranteedOffer: {} }), allowed) ?? '', /shielded offers/);
  assert.match(
    sponsorPolicy(view({ fallibleOffer: new Map([[1, {}]]) }), allowed) ?? '',
    /shielded offers/,
  );
});

test('a calls-only transaction with a dust-only deficit is allowed', () => {
  const v = view({
    imbalance: { 0: [[DUST, -9000n]], 1: [[DUST, -1n]] },
  });
  assert.equal(sponsorPolicy(v, allowed), undefined);
});

test('the adapter drops absent and empty offers, Dust and keeps real ones', () => {
  const empty: LedgerIntentLike = {
    actions: [],
    guaranteedUnshieldedOffer: undefined,
    fallibleUnshieldedOffer: undefined,
    dustActions: undefined,
  };
  const tx: LedgerTxLike = {
    rewards: undefined,
    intents: new Map<number, LedgerIntentLike>([
      [1, empty],
      [2, { ...empty, dustActions: { spends: [], registrations: [] } }],
      [3, { ...empty, dustActions: { spends: [], registrations: [{}] } }],
      [4, { ...empty, fallibleUnshieldedOffer: {} }],
    ]),
    guaranteedOffer: undefined,
    fallibleOffer: new Map(),
    imbalances: () => new Map(),
  };
  const v = viewOfLedgerTx(tx, classes);
  assert.equal('guaranteedOffer' in v, false);
  assert.equal('fallibleOffer' in v, false, 'an empty map holds no offer');
  const keys = (n: number) => Object.keys(v.intents?.get(n) ?? {}).sort();
  assert.deepEqual(keys(1), ['actions']);
  assert.deepEqual(keys(2), ['actions']);
  assert.deepEqual(keys(3), ['actions', 'dustActions']);
  assert.deepEqual(keys(4), ['actions', 'fallibleUnshieldedOffer']);
  const shielded = viewOfLedgerTx(
    { ...tx, guaranteedOffer: {}, fallibleOffer: new Map([[5, {}]]) },
    classes,
  );
  assert.ok('guaranteedOffer' in shielded && 'fallibleOffer' in shielded);
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
      [
        1,
        {
          actions: [new FakeCall(ADDR), new FakeDeploy(), new FakeUpdate(), {}],
          guaranteedUnshieldedOffer: undefined,
          fallibleUnshieldedOffer: undefined,
          dustActions: undefined,
        },
      ],
    ]),
    guaranteedOffer: undefined,
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
    {
      ...tx,
      intents: new Map([
        [
          1,
          {
            actions: [{ entryPoint: 'y', address: ADDR }],
            guaranteedUnshieldedOffer: undefined,
            fallibleUnshieldedOffer: undefined,
            dustActions: undefined,
          },
        ],
      ]),
    },
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
  'the real ledger: unshielded offers are refused, and a call-less deploy shows no false positives',
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
      Intent: {
        new: (ttl: Date) => { guaranteedUnshieldedOffer: unknown; addDeploy(d: unknown): unknown };
      };
      UnshieldedOffer: { new: (inputs: unknown[], outputs: unknown[], sigs: unknown[]) => unknown };
      ContractState: new () => unknown;
      ContractDeploy: new (state: unknown) => unknown;
    } & Omit<ActionClasses, 'ContractDeploy'>;
    const ttl = () => new Date(Date.now() + 60_000);
    const viewOf = (intent: unknown) =>
      viewOfLedgerTx(
        ledger.Transaction.deserialize(
          'signature',
          'pre-proof',
          'pre-binding',
          ledger.Transaction.fromParts('undeployed', undefined, undefined, intent).serialize(),
        ),
        ledger,
      );
    /** The real intent's view with a sponsored call in place of its (empty) action list. */
    const withCall = (v: SponsorTxView): SponsorTxView => ({
      ...v,
      intents: new Map(
        [...(v.intents ?? [])].map(([segment, intent]) => [
          segment,
          { ...intent, actions: [call()] },
        ]),
      ),
    });

    // Nothing but a deploy: the offer, Dust and shielded fields must all read as absent, so only
    // the deploy refuses it.
    const plain = viewOf(
      ledger.Intent.new(ttl()).addDeploy(new ledger.ContractDeploy(new ledger.ContractState())),
    );
    assert.match(sponsorPolicy(plain, allowed) ?? '', /deploy actions/);
    assert.equal(sponsorPolicy(withCall(plain), allowed), undefined);

    // An offer that pays out: refused as an offer, and (defence in depth) by its imbalance.
    const paying = ledger.Intent.new(ttl());
    paying.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new(
      [],
      [{ value: 5n, owner: '11'.repeat(32), type: '22'.repeat(32) }],
      [],
    );
    const payingView = viewOf(paying);
    assert.ok(payingView.segments.length >= 2, `segments ${payingView.segments.join(',')}`);
    assert.match(sponsorPolicy(withCall(payingView), allowed) ?? '', /unshielded offers/);
    const stripped: SponsorTxView = {
      ...payingView,
      intents: new Map([[1, { actions: [call()] }]]),
    };
    assert.match(sponsorPolicy(stripped, allowed) ?? '', /moves unshielded value/);

    // A net-zero (here empty) offer is still an offer: the exploit shape, with a call alongside.
    const empty = ledger.Intent.new(ttl());
    empty.guaranteedUnshieldedOffer = ledger.UnshieldedOffer.new([], [], []);
    assert.match(sponsorPolicy(withCall(viewOf(empty)), allowed) ?? '', /unshielded offers/);
  },
);
