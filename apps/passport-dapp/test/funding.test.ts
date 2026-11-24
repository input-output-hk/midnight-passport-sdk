import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseFundingDiscovery,
  fundingFailure,
  fundingRequestFailure,
  fundingExchange,
  canFund,
  preferredFundingAsset,
  fundingDescription,
  parseFundingOriginalStatus,
  waitForFundingOriginal,
  savedFundingAssets,
  fundingProgressMessage,
} from '../src/funding.js';
import { EventLog } from '../src/event-log.js';
import { demoActivityObservation } from '../src/activity-observations.js';
import { plainError } from '../src/flows.js';

const color = 'ab'.repeat(32);
const row = { color, amount: '10', availability: 'insufficient' } as const;
test('funding progress identifies the durable proof and balance phases', () => {
  assert.match(
    fundingProgressMessage({ phase: 'wallet-preparation' }),
    /Preparing the funding wallet/,
  );
  assert.match(fundingProgressMessage({ phase: 'acc-proof' }), /Proving the ACC deposit/);
  assert.match(fundingProgressMessage({ phase: 'wallet-balancing' }), /Balancing the proved/);
  assert.match(
    fundingProgressMessage({ phase: 'credit-confirmation' }),
    /Waiting for confirmed ACC credit/,
  );
  assert.match(fundingProgressMessage({ preparationTxId: 'prepared' }), /Proving the ACC deposit/);
});
test('saved funding remains selectable after inventory disappears on reload', () => {
  const account = 'cd'.repeat(32);
  const network = 'undeployed';
  const original = '346b2744-dedb-432e-9cbd-2b56f64c5957';
  const records = new Map([
    [`passport-demo:fund:${network}:${account}:${color}`, original],
    [`passport-demo:fund:${network}:${'ef'.repeat(32)}:${'00'.repeat(32)}`, original],
    [`passport-demo:fund:${network}:${account}:${'xx'.repeat(32)}`, original],
  ]);
  const storage = {
    get length() {
      return records.size;
    },
    key: (index: number) => [...records.keys()][index] ?? null,
    getItem: (key: string) => records.get(key) ?? null,
  };
  assert.deepEqual(savedFundingAssets(storage, network, account), [
    { color, amount: '0', availability: 'unavailable' },
  ]);
  records.set(`passport-demo:fund:${network}:${account}:${color}`, 'invalid');
  assert.deepEqual(savedFundingAssets(storage, network, account), []);
});
test('funding status resumes the original without a second request and checks exact identity', async () => {
  const identity = {
    requestId: 'original',
    accountAddress: 'cd'.repeat(32),
    color,
    amount: '10',
  };
  let reads = 0;
  let clock = 0;
  const pending: unknown[] = [];
  const result = await waitForFundingOriginal(
    async () => {
      reads++;
      return reads === 1
        ? { ...identity, state: 'pending', progress: { preparationTxId: 'prepared' } }
        : { ...identity, state: 'complete', result: { requestId: identity.requestId, txId: 'tx' } };
    },
    identity,
    (progress) => pending.push(progress),
    {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      pollMs: 5,
    },
  );
  assert.equal(result.result?.txId, 'tx');
  assert.equal(reads, 2);
  assert.deepEqual(pending, [{ preparationTxId: 'prepared' }]);
  assert.equal(
    parseFundingOriginalStatus(
      { ...identity, amount: '11', state: 'pending' },
      { requestId: identity.requestId, accountAddress: identity.accountAddress, color },
    ).amount,
    '11',
    'a saved original remains observable if the current funding policy changed',
  );
  for (const bad of [
    { ...identity, state: 'complete', result: { requestId: 'other' } },
    { ...identity, color: 'ef'.repeat(32), state: 'pending' },
    { ...identity, state: 'unknown' },
  ])
    assert.throws(() => parseFundingOriginalStatus(bad, identity));
  await assert.rejects(
    waitForFundingOriginal(
      async () => ({ ...identity, state: 'pending' }),
      identity,
      () => {},
      { now: () => 1, timeoutMs: 0 },
    ),
    { name: 'FundingRejected' },
  );
});
test('inventory discovery preserves withdrawal assets but fails closed for deposits', () => {
  const bounded = Array.from({ length: 65 }, (_, i) => ({
    ...row,
    color: (i + 1).toString(16).padStart(64, '0'),
  }));
  assert.equal(
    parseFundingDiscovery({ assets: bounded.slice(0, 64), balanceAssetColor: bounded[0]?.color })
      .assets.length,
    64,
  );
  assert.throws(() =>
    parseFundingDiscovery({ assets: bounded, balanceAssetColor: bounded[0]?.color }),
  );
  assert.equal(canFund(false, true, { ...row, availability: 'available' }), true);
  assert.equal(canFund(false, true, row), false);
  assert.equal(
    parseFundingDiscovery({ assets: [row], balanceAssetColor: color }).assets[0]?.availability,
    'insufficient',
  );
  for (const availability of [undefined, null, 'true', {}, true])
    assert.equal(
      parseFundingDiscovery({ assets: [{ ...row, availability }], balanceAssetColor: color })
        .assets[0]?.availability,
      'unavailable',
    );
  for (const value of [
    null,
    {},
    { assets: [] },
    { assets: [row, row], balanceAssetColor: color },
    { assets: [{ ...row, amount: '9'.repeat(5000) }], balanceAssetColor: color },
    { assets: [row], balanceAssetColor: 'other' },
  ])
    assert.throws(() => parseFundingDiscovery(value));
});

test('lost and malformed funding responses remain unknown without clearing stored IDs', async () => {
  for (const send of [
    async () => {
      throw Error('connection lost');
    },
    async () => new Response('broken'),
    async () => Response.json(null),
    async () => Response.json([]),
  ]) {
    await assert.rejects(fundingExchange(send), { name: 'FundingRejected' });
  }
  const value = await fundingExchange(async () => Response.json({ requestId: 'original' }));
  assert.equal(value.result.requestId, 'original');
});

test('only the exact no-start intent is removed; concurrent replacement and unknown IDs are retained', () => {
  for (const proved of [false, true]) {
    const entries = new Map([
      ['original-key', 'original'],
      ['legacy-key', 'newer'],
    ]);
    const notices: unknown[] = [];
    fundingRequestFailure({
      status: proved ? 409 : 502,
      result: proved
        ? { requestId: 'original', code: 'FundingAssetUnavailable', submission: 'not-started' }
        : { error: 'unknown' },
      requestId: 'original',
      storage: {
        getItem: (key) => entries.get(key) ?? null,
        removeItem: (key) => {
          entries.delete(key);
        },
      },
      keys: ['original-key', 'legacy-key'],
      onNotStarted: (event) => notices.push(event),
    });
    assert.equal(entries.get('original-key'), proved ? undefined : 'original');
    assert.equal(entries.get('legacy-key'), 'newer');
    assert.equal(notices.length, proved ? 1 : 0);
  }
});
test('only an exact operator-reconciled tombstone clears the old browser funding ID', () => {
  const entries = new Map([['funding-key', 'original']]);
  const notices: unknown[] = [];
  const input = {
    status: 409,
    requestId: 'original',
    storage: {
      getItem: (key: string) => entries.get(key) ?? null,
      removeItem: (key: string) => {
        entries.delete(key);
      },
    },
    keys: ['funding-key'],
    onNotStarted: () => assert.fail('A rejected submission did start.'),
    onReconciled: (event: unknown) => notices.push(event),
  };
  const receipt = {
    requestId: 'original',
    code: 'FundingRequestReleased',
    submission: 'reconciled-no-credit',
  };
  for (const bad of [
    { ...receipt, requestId: 'other' },
    { ...receipt, txId: 'ab'.repeat(32) },
    { ...receipt, submission: 'unknown' },
  ]) {
    assert.equal(fundingRequestFailure({ ...input, result: bad }).name, 'FundingRejected');
    assert.equal(entries.get('funding-key'), 'original');
  }
  assert.equal(fundingRequestFailure({ ...input, result: receipt }).name, 'FundingRequestReleased');
  assert.equal(entries.has('funding-key'), false);
  assert.deepEqual(notices, [{ requestId: 'original', code: 'FundingRequestReleased' }]);
});
test('only a pinned no-start receipt permits forgetting a funding ID; old unknown responses remain unknown', () => {
  const receipt = {
    requestId: 'original',
    submission: 'not-started',
    code: 'FundingAssetUnavailable',
  };
  assert.equal(fundingFailure(409, receipt, 'original').notStarted, true);
  assert.equal(
    fundingFailure(503, { ...receipt, code: 'FundingWalletUnavailable' }, 'original').notStarted,
    true,
  );
  for (const [status, body] of [
    [502, receipt],
    [409, { ...receipt, requestId: 'other' }],
    [409, { ...receipt, txId: 'ab'.repeat(32) }],
    [409, { ...receipt, preparationTxId: 'ab'.repeat(32) }],
    [409, { ...receipt, submission: 'unknown' }],
    [409, { ...receipt, code: 'other' }],
    [503, null],
  ]) {
    const failure = fundingFailure(Number(status), body, 'original');
    assert.equal(failure.notStarted, false);
    assert.equal(failure.error.name, 'FundingRejected');
  }
});
test('proved refusal is failed in Activity while an uncertain funding outcome still needs reconciliation', () => {
  for (const proved of [true, false]) {
    const log = new EventLog(() => 1000);
    log.start('fund');
    const failure = fundingFailure(
      proved ? 409 : 502,
      proved
        ? { requestId: 'original', submission: 'not-started', code: 'FundingAssetUnavailable' }
        : { error: 'Funding outcome requires reconciliation' },
      'original',
    );
    log.fail(plainError(failure.error, 'http://localhost:8787'));
    assert.equal(
      demoActivityObservation(log, 1000, { accountOpen: true, walletConnected: false }).operation
        ?.phase,
      proved ? 'failed' : 'unknown',
    );
    if (proved) assert.match(log.last?.error?.hint ?? '', /No transfer was started/);
  }
});

test('a funding refresh preserves intent even when the selected asset becomes unavailable', () => {
  const custom = { ...row, availability: 'available' } as const;
  const night = { ...custom, color: '00'.repeat(32) };
  assert.equal(preferredFundingAsset([night, custom], color)?.color, color);
  assert.equal(
    preferredFundingAsset([night, { ...custom, availability: 'insufficient' }], color)?.color,
    color,
  );
  assert.equal(canFund(false, true, preferredFundingAsset([row], color)), false);
  assert.equal(preferredFundingAsset([night], 'removed'), undefined);
  assert.equal(preferredFundingAsset([night], '')?.color, night.color);
  assert.equal(preferredFundingAsset([row], '')?.color, color);
  assert.match(fundingDescription(row), /Deposits are unavailable/);
  assert.match(fundingDescription(night), /^Deposit the selected asset/);
});
