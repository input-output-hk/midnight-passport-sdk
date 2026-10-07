// What the Copy button puts on the clipboard (src/evidence.ts): the header, the account and the
// wallet as the page shows them, and the event log's rows, with no member the views do not name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventLog } from '../src/event-log.ts';
import { buildEvidence, evidenceJson, type EvidenceParts } from '../src/evidence.ts';
import type { AccountView, EvidenceHeader, WalletView } from '../src/ui.ts';

const header: EvidenceHeader = {
  note: 'Prototype',
  passkey: 'browser authenticator',
  network: 'undeployed',
  serviceUrl: 'http://localhost:8787',
  pinnedManifestSha256: 'ab'.repeat(32),
  apiVersion: '1.0.0',
};

const account: AccountView = {
  address: 'cd'.repeat(32),
  networkId: 'undeployed',
  bindingId: 'acc-45721e1',
  state: { booted: true, authNonce: 7n, deviceEpoch: 0n, entryCount: 1, specVersion: 2 },
  lastTx: { txHash: 'ef'.repeat(32), blockHeight: 42 },
};

function parts(over: Partial<EvidenceParts> = {}): EvidenceParts {
  const log = new EventLog(() => 0);
  log.start('open');
  log.finish();
  return {
    header,
    page: 'http://localhost:5173',
    account,
    wallet: {},
    runs: log.toJSON(),
    ...over,
  };
}

test('the evidence is the header, the page, the account, the wallet and the runs', () => {
  const evidence = buildEvidence(
    parts({ wallet: { unshieldedAddress: 'mn_addr_undeployed1xyz' } }),
  );
  assert.deepEqual(Object.keys(evidence).sort(), [
    'account',
    'apiVersion',
    'network',
    'note',
    'page',
    'passkey',
    'pinnedManifestSha256',
    'runs',
    'serviceUrl',
    'wallet',
  ]);
  assert.equal(evidence.page, 'http://localhost:5173');
  assert.equal(evidence.network, 'undeployed');
  assert.equal(evidence.pinnedManifestSha256, 'ab'.repeat(32));
});

test('the rows are the log’s own rows, not a second account of the run', () => {
  const log = new EventLog(() => 1_000);
  log.start('rotate');
  log.fail({ code: 'UserCancelled', message: 'cancelled', hint: 'nothing was submitted' });
  const runs = log.toJSON();
  assert.equal(buildEvidence(parts({ runs })).runs, runs);
  const parsed = JSON.parse(evidenceJson(parts({ runs }))) as { runs: { result: string }[] };
  assert.deepEqual(parsed.runs, JSON.parse(JSON.stringify(runs)));
  assert.equal(parsed.runs[0]?.result, 'failed');
});

test('the account section names its five members and nothing more', () => {
  const view = {
    ...account,
    credentialId: Uint8Array.of(1, 2, 3),
    seed: 'must not travel',
    publicKey: { x: 1n },
  } as AccountView;
  const evidence = buildEvidence(parts({ account: view }));
  assert.deepEqual(Object.keys(evidence.account ?? {}).sort(), [
    'address',
    'bindingId',
    'lastTx',
    'networkId',
    'state',
  ]);
  const text = evidenceJson(parts({ account: view }));
  assert.ok(!text.includes('must not travel'));
  assert.ok(!text.includes('credentialId'));
});

test('with no account open there is no account section, and without a wallet there is no wallet section', () => {
  const text = evidenceJson(parts({ account: undefined, wallet: {} }));
  const parsed = JSON.parse(text) as Record<string, unknown>;
  assert.equal('account' in parsed, false);
  assert.equal('wallet' in parsed, false);
  assert.ok('runs' in parsed);
});

test('a transaction the account has not made leaves lastTx out', () => {
  const { lastTx: _gone, ...without } = account;
  const parsed = JSON.parse(evidenceJson(parts({ account: without }))) as {
    account: Record<string, unknown>;
  };
  assert.equal('lastTx' in parsed.account, false);
  assert.equal((parsed.account as { address: string }).address, account.address);
});

test('counters and balances are bigints in memory and decimal strings in the text', () => {
  const wallet: WalletView = {
    unshieldedAddress: 'mn_addr_undeployed1xyz',
    unshieldedBalances: { [`${'0'.repeat(64)}`]: 50_000_000_000_000n },
    dust: { balance: 123n, cap: 10n ** 20n },
  };
  const parsed = JSON.parse(evidenceJson(parts({ wallet }))) as {
    account: { state: { authNonce: string; deviceEpoch: string; entryCount: number } };
    wallet: { unshieldedBalances: Record<string, string>; dust: { balance: string; cap: string } };
  };
  assert.equal(parsed.account.state.authNonce, '7');
  assert.equal(parsed.account.state.deviceEpoch, '0');
  assert.equal(parsed.account.state.entryCount, 1, 'a plain number stays a number');
  assert.deepEqual(Object.values(parsed.wallet.unshieldedBalances), ['50000000000000']);
  assert.deepEqual(parsed.wallet.dust, { balance: '123', cap: '100000000000000000000' });
});

test('the text is indented JSON that round-trips, so it pastes into an issue as it is', () => {
  const text = evidenceJson(parts());
  assert.match(text, /^\{\n {2}"note"/);
  assert.doesNotThrow(() => JSON.parse(text));
});

test('a wallet view carries addresses and balances: no seed field exists to be copied', () => {
  const wallet: WalletView = {
    unshieldedAddress: 'a',
    shieldedAddress: 'b',
    dustAddress: 'c',
    unshieldedBalances: {},
    dust: { balance: 0n, cap: 0n },
    balanceError: 'timed out',
  };
  assert.deepEqual(Object.keys(buildEvidence(parts({ wallet })).wallet ?? {}).sort(), [
    'balanceError',
    'dust',
    'dustAddress',
    'shieldedAddress',
    'unshieldedAddress',
    'unshieldedBalances',
  ]);
});
