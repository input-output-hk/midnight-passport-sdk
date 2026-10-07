// Edges of src/sponsor-policy.ts beyond sponsor-policy.test.ts: which refusal wins when several
// apply, which segments and tokens are looked at, what the adapter does with odd ledger values,
// and how guardedBalance orders its checks and reads the allowed set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpError } from '../src/http.ts';
import {
  guardedBalance,
  sponsorPolicy,
  viewOfLedgerTx,
  type ActionClasses,
  type LedgerIntentLike,
  type LedgerTxLike,
  type SponsorTxView,
} from '../src/sponsor-policy.ts';

const ADDR = 'ab'.repeat(32);
const OTHER = 'cd'.repeat(32);
const allowed = new Set([ADDR]);
const DUST = { tag: 'dust' };
const SHIELDED = { tag: 'shielded' };

const call = (address: string = ADDR) => ({ kind: 'call' as const, address });

function view(over: Partial<SponsorTxView> = {}): SponsorTxView {
  return {
    intents: new Map([[1, { actions: [call()] }]]),
    segments: [0, 1],
    imbalances: () => new Map(),
    ...over,
  };
}

const refusal = (v: SponsorTxView, set: ReadonlySet<string> = allowed) =>
  sponsorPolicy(v, set) ?? '';

test('rewards are refused first, even from a transaction that is otherwise empty', () => {
  assert.match(refusal(view({ rewards: {}, intents: new Map() })), /rewards/);
  assert.match(refusal(view({ rewards: {}, guaranteedOffer: {} })), /rewards/);
});

test('with no intents, the shielded-offer refusal is not reached: there is nothing to sponsor first', () => {
  assert.match(refusal(view({ intents: new Map(), guaranteedOffer: {} })), /no intents/);
});

test('shielded offers are refused before unshielded offers, Dust, actions and imbalances', () => {
  const messy = view({
    guaranteedOffer: {},
    intents: new Map([
      [
        1,
        { actions: [{ kind: 'deploy' as const }], guaranteedUnshieldedOffer: {}, dustActions: {} },
      ],
    ]),
    imbalances: () => new Map([[SHIELDED, 5n]]),
  });
  assert.match(refusal(messy), /shielded offers/);
});

test('an offer or Dust action in any intent is refused, even after a clean one', () => {
  for (const bad of [
    { actions: [call()], fallibleUnshieldedOffer: {} },
    { actions: [call()], guaranteedUnshieldedOffer: {} },
    { actions: [call()], dustActions: { spends: [{}] } },
  ]) {
    const v = view({
      intents: new Map<number, { actions: ReturnType<typeof call>[] }>([
        [1, { actions: [call()] }],
        [2, bad],
      ]),
      segments: [0, 1, 2],
    });
    assert.match(refusal(v), /unshielded offers|Dust actions/);
  }
});

test('every call in every intent must be to an allowed account, in any order', () => {
  const two = (first: string, second: string) =>
    view({
      intents: new Map([
        [1, { actions: [call(first)] }],
        [2, { actions: [call(second)] }],
      ]),
      segments: [0, 1, 2],
    });
  assert.equal(sponsorPolicy(two(ADDR, ADDR), allowed), undefined);
  assert.match(refusal(two(ADDR, OTHER)), /not to a Passport account/);
  assert.match(refusal(two(OTHER, ADDR)), /not to a Passport account/);
  const both = new Set([ADDR, OTHER]);
  assert.equal(sponsorPolicy(two(ADDR, OTHER), both), undefined);
});

test('an action that is not a call is refused by its kind, before the next action is looked at', () => {
  const v = view({
    intents: new Map([[1, { actions: [{ kind: 'maintenance' as const }, call(OTHER)] }]]),
  });
  assert.match(refusal(v), /maintenance actions are not sponsored/);
});

test('nothing is sponsored when the allowed set is empty', () => {
  assert.match(refusal(view(), new Set()), /not to a Passport account/);
});

test('the allowed set is exact: an upper-case entry never matches, because addresses are lower-cased', () => {
  assert.match(refusal(view(), new Set([ADDR.toUpperCase()])), /not to a Passport account/);
});

test('a zero imbalance of any token is fine; any non-zero one that is not Dust names its token and segment', () => {
  const zero = view({
    imbalances: () =>
      new Map([
        [SHIELDED, 0n],
        [{ tag: 'unshielded' }, 0n],
      ]),
  });
  assert.equal(sponsorPolicy(zero, allowed), undefined);
  const paid = view({
    segments: [0, 1, 4],
    imbalances: (s) =>
      new Map(
        s === 4
          ? [
              [DUST, -1n],
              [{ tag: 'unshielded' }, 3n],
            ]
          : [],
      ),
  });
  assert.match(refusal(paid), /moves unshielded value in segment 4; only fees are sponsored/);
});

test('Dust of either sign is fee money, but a differently spelled Dust tag is not recognised', () => {
  assert.equal(
    sponsorPolicy(view({ imbalances: () => new Map([[DUST, 10n ** 30n]]) }), allowed),
    undefined,
  );
  assert.match(refusal(view({ imbalances: () => new Map([[{ tag: 'Dust' }, 1n]]) })), /Dust value/);
});

test('only the listed segments are checked, and a failure in the last one still refuses', () => {
  const checked: number[] = [];
  const v = view({
    segments: [0, 1, 2, 3],
    imbalances: (s) => {
      checked.push(s);
      if (s === 3) throw new Error('segment 3 is not computable');
      return new Map();
    },
  });
  assert.match(refusal(v), /imbalances of segment 3 cannot be computed/);
  assert.deepEqual(checked, [0, 1, 2, 3]);
  // A segment that is not listed is never asked about, so an imbalance there goes unseen.
  const unlisted = view({
    segments: [0],
    imbalances: (s) => {
      assert.equal(s, 0);
      return new Map();
    },
  });
  assert.equal(sponsorPolicy(unlisted, allowed), undefined);
});

class FakeCall {
  entryPoint = 'x';
  constructor(readonly address: unknown) {}
}
class FakeDeploy {}
class FakeUpdate {}
const classes: ActionClasses = {
  ContractCall: FakeCall,
  ContractDeploy: FakeDeploy,
  MaintenanceUpdate: FakeUpdate,
};
const bareIntent = (over: Partial<LedgerIntentLike> = {}): LedgerIntentLike => ({
  actions: [],
  guaranteedUnshieldedOffer: undefined,
  fallibleUnshieldedOffer: undefined,
  dustActions: undefined,
  ...over,
});
const ledgerTx = (over: Partial<LedgerTxLike> = {}): LedgerTxLike => ({
  rewards: undefined,
  intents: new Map([[1, bareIntent({ actions: [new FakeCall(ADDR)] })]]),
  guaranteedOffer: undefined,
  fallibleOffer: undefined,
  imbalances: () => new Map(),
  ...over,
});

test('null offers and a null Dust field read as absent, like undefined ones', () => {
  const tx = ledgerTx({
    guaranteedOffer: null,
    intents: new Map([
      [
        1,
        bareIntent({
          actions: [new FakeCall(ADDR)],
          guaranteedUnshieldedOffer: null,
          fallibleUnshieldedOffer: null,
          dustActions: null as never,
        }),
      ],
    ]),
  });
  const v = viewOfLedgerTx(tx, classes);
  assert.equal('guaranteedOffer' in v, false);
  assert.deepEqual(Object.keys(v.intents?.get(1) ?? {}), ['actions']);
  assert.equal(sponsorPolicy(v, allowed), undefined);
});

test('a call whose address is not a string is a call to nowhere, which is refused', () => {
  for (const address of [undefined, 5, null, { bytes: [1] }]) {
    const v = viewOfLedgerTx(
      ledgerTx({ intents: new Map([[1, bareIntent({ actions: [new FakeCall(address)] })]]) }),
      classes,
    );
    assert.deepEqual(v.intents?.get(1)?.actions, [{ kind: 'call' }]);
    assert.match(refusal(v), /not to a Passport account/);
  }
});

test('a transaction with no intents map has no intents key, and the policy refuses it', () => {
  const v = viewOfLedgerTx(ledgerTx({ intents: undefined }), classes);
  assert.equal('intents' in v, false);
  assert.deepEqual(v.segments, [0]);
  assert.match(refusal(v), /no intents/);
});

test('segments are the guaranteed one plus every intent and fallible-offer segment, each once', () => {
  const v = viewOfLedgerTx(
    ledgerTx({
      intents: new Map([
        [2, bareIntent({ actions: [new FakeCall(ADDR)] })],
        [1, bareIntent({ actions: [new FakeCall(ADDR)] })],
      ]),
      fallibleOffer: new Map<number, unknown>([
        [2, {}],
        [3, {}],
      ]),
    }),
    classes,
  );
  assert.deepEqual([...v.segments].sort(), [0, 1, 2, 3]);
});

test('imbalances are asked of the ledger by segment, as the policy asks them', () => {
  const asked: number[] = [];
  const v = viewOfLedgerTx(
    ledgerTx({
      intents: new Map([[1, bareIntent({ actions: [new FakeCall(ADDR)] })]]),
      imbalances: (segment) => {
        asked.push(segment);
        return new Map([[DUST, -4n]]);
      },
    }),
    classes,
  );
  assert.equal(sponsorPolicy(v, allowed), undefined);
  assert.deepEqual(asked, [0, 1]);
});

test('the adapter keeps one intent’s offer apart from another’s', () => {
  const v = viewOfLedgerTx(
    ledgerTx({
      intents: new Map([
        [1, bareIntent({ actions: [new FakeCall(ADDR)] })],
        [2, bareIntent({ actions: [new FakeCall(ADDR)], fallibleUnshieldedOffer: {} })],
      ]),
    }),
    classes,
  );
  assert.deepEqual(Object.keys(v.intents?.get(1) ?? {}), ['actions']);
  assert.deepEqual(Object.keys(v.intents?.get(2) ?? {}).sort(), [
    'actions',
    'fallibleUnshieldedOffer',
  ]);
});

function guarded(
  over: { deserialize?: (b: Uint8Array) => LedgerTxLike; allowed?: () => ReadonlySet<string> } = {},
) {
  const seen: { balance: Uint8Array[]; allowed: number } = { balance: [], allowed: 0 };
  const run = guardedBalance({
    deserialize: over.deserialize ?? (() => ledgerTx()),
    classes,
    allowed: () => {
      seen.allowed++;
      return over.allowed ? over.allowed() : allowed;
    },
    balance: async (bytes) => {
      seen.balance.push(bytes);
      return Uint8Array.of(...bytes, 0xbb);
    },
  });
  return { run, seen };
}

test('an accepted transaction reaches the wallet as the very bytes received, and its answer comes back', async () => {
  const { run, seen } = guarded();
  const bytes = Uint8Array.of(1, 2, 3);
  assert.deepEqual(await run(bytes), Uint8Array.of(1, 2, 3, 0xbb));
  assert.equal(seen.balance[0], bytes, 'not re-serialised');
});

test('bytes that do not deserialise are 400 whatever the parser throws, and the allowed set is not read', async () => {
  for (const thrown of [new Error('wasm: bad tx'), 'a string', undefined, null, 42]) {
    const { run, seen } = guarded({
      deserialize: () => {
        throw thrown;
      },
    });
    await assert.rejects(run(Uint8Array.of(1)), (e) => {
      assert.ok(e instanceof HttpError);
      assert.equal(e.status, 400);
      assert.match(e.message, /not a serialised, proven, unbound transaction/);
      return true;
    });
    assert.equal(seen.allowed, 0);
    assert.equal(seen.balance.length, 0);
  }
});

test('a refusal is 403 with the policy’s reason, and the wallet is never reached', async () => {
  const { run, seen } = guarded({ allowed: () => new Set([OTHER]) });
  await assert.rejects(run(Uint8Array.of(1)), (e) => {
    assert.ok(e instanceof HttpError);
    assert.equal(e.status, 403);
    assert.match(e.message, /not to a Passport account deployed by this service/);
    return true;
  });
  assert.equal(seen.balance.length, 0);
});

test('the allowed set is read afresh for every request, so a new deployment counts at once', async () => {
  let current: ReadonlySet<string> = new Set();
  const { run, seen } = guarded({ allowed: () => current });
  await assert.rejects(run(Uint8Array.of(1)), { status: 403 });
  current = new Set([ADDR]);
  await run(Uint8Array.of(2));
  current = new Set();
  await assert.rejects(run(Uint8Array.of(3)), { status: 403 });
  assert.equal(seen.allowed, 3);
  assert.equal(seen.balance.length, 1);
});

test('a failure inside the allowed-set read refuses the request and reaches the wallet not at all', async () => {
  const { run, seen } = guarded({
    allowed: () => {
      throw new Error('deployments file is not a map of address lists');
    },
  });
  await assert.rejects(run(Uint8Array.of(1)), /deployments file/);
  assert.equal(seen.balance.length, 0);
});

test('a wallet failure after an accepted transaction passes through unchanged', async () => {
  const boom = new Error('wallet out of dust');
  const run = guardedBalance({
    deserialize: () => ledgerTx(),
    classes,
    allowed: () => allowed,
    balance: async () => {
      throw boom;
    },
  });
  await assert.rejects(run(Uint8Array.of(1)), (e) => e === boom);
});
