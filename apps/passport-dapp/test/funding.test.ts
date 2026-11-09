import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseFundingDiscovery,
  fundingFailure,
  fundingRequestFailure,
  fundingExchange,
  canFund,
  preferredFundingAsset,
} from '../src/funding.js';
import { EventLog } from '../src/event-log.js';
import { demoActivityObservation } from '../src/activity-observations.js';
import { plainError } from '../src/flows.js';

const color = 'ab'.repeat(32);
const row = { color, amount: '10', availability: 'insufficient' } as const;
test('inventory discovery preserves withdrawal assets but fails closed for deposits', () => {
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

test('a funding refresh retains an available custom asset and falls back only when it becomes unavailable', () => {
  const custom = { ...row, availability: 'available' } as const;
  const night = { ...custom, color: '00'.repeat(32) };
  assert.equal(preferredFundingAsset([night, custom], color)?.color, color);
  assert.equal(
    preferredFundingAsset([night, { ...custom, availability: 'insufficient' }], color)?.color,
    night.color,
  );
  assert.equal(preferredFundingAsset([row], color), undefined);
});
