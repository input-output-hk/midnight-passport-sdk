import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NIGHT_SEND_OPERATIONS } from '../src/midnames/night-send.js';
import type { BrowserNightSendRecord } from '../src/midnames/night-send-journal.js';
import {
  localNightChain,
  localNightEndpoint,
  localNightNetwork,
  namedNightStatus,
  newNamedNightRequest,
  sameLocalNightIndexer,
} from '../src/midnames/night-send-page-state.js';

const request = {
  requestId: '12345678-1234-1234-1234-123456789abc',
  name: 'alice.night',
  amount: '4',
  networkId: 'undeployed',
  source: '1'.repeat(64),
  bridge: '2'.repeat(64),
};
const record: BrowserNightSendRecord = {
  version: 1,
  credentialId: '3'.repeat(64),
  intent: {
    ...request,
    asset: 'NIGHT',
    target: '4'.repeat(64),
    providerId: `midnames:${'5'.repeat(64)}`,
    namespace: 'night',
    operations: NIGHT_SEND_OPERATIONS,
  },
};
const withdrawal = { hash: '6'.repeat(64), identifiers: [`07${'8'.repeat(64)}`] };
const deposit = { hash: '9'.repeat(64), identifiers: [`07${'a'.repeat(64)}`] };

test('opt-in named NIGHT payment accepts only local demo endpoints', () => {
  assert.equal(localNightNetwork('undeployed'), true);
  assert.equal(localNightNetwork('preview'), false);
  for (const endpoint of ['http://localhost:6300', 'http://127.0.0.1:6300', 'http://[::1]:6300'])
    assert.equal(localNightEndpoint(endpoint, 'http'), true);
  for (const endpoint of ['https://localhost:6300', 'http://example.com:6300', 'not-a-url'])
    assert.equal(localNightEndpoint(endpoint, 'http'), false);
  assert.equal(localNightEndpoint('ws://localhost:6300', 'ws'), true);
  assert.equal(localNightEndpoint('wss://localhost:6300', 'ws'), false);
  assert.equal(localNightEndpoint(undefined, 'ws'), false);
  const serviceConfig = {
    indexerUri: 'http://127.0.0.1:6300',
    indexerWsUri: 'ws://127.0.0.1:6300',
    nodeUri: 'http://127.0.0.1:19944',
  };
  assert.equal(localNightChain(serviceConfig), true);
  assert.equal(localNightChain({ ...serviceConfig, nodeUri: 'ws://127.0.0.1:19944' }), false);
  assert.equal(localNightChain({ ...serviceConfig, nodeUri: 'https://node.example' }), false);
  assert.equal(
    sameLocalNightIndexer(serviceConfig, serviceConfig.indexerUri, serviceConfig.indexerWsUri),
    true,
  );
  assert.equal(
    sameLocalNightIndexer(serviceConfig, 'http://127.0.0.1:18088', serviceConfig.indexerWsUri),
    false,
  );
  assert.equal(
    sameLocalNightIndexer(serviceConfig, serviceConfig.indexerUri, 'ws://127.0.0.1:18088'),
    false,
  );
});

test('page validates the human request before name lookup or owner approval', () => {
  assert.deepEqual(newNamedNightRequest({ ...request, name: ' alice.night ', amount: ' 4 ' }), {
    ...request,
    asset: 'NIGHT',
  });
  for (const changed of [
    { name: 'Alice.night' },
    { name: 'alice.midnight' },
    { amount: '0' },
    { amount: '-1' },
    { amount: (1n << 128n).toString() },
    { bridge: 'not-a-wallet-address' },
    { source: 'not-an-account-address' },
    { networkId: 'preview' },
    { requestId: 'reused' },
  ]) {
    assert.throws(() => newNamedNightRequest({ ...request, ...changed }), /canonical .night name/);
  }
});

test('page keeps each original NIGHT payment phase and transaction ID visible', () => {
  assert.match(namedNightStatus(undefined), /No named NIGHT payment/);
  assert.match(namedNightStatus(record), /no saved transaction ID/);
  assert.match(namedNightStatus(record), /cannot be retried automatically/);
  assert.match(namedNightStatus({ ...record, withdrawal }), new RegExp(withdrawal.hash));
  assert.match(namedNightStatus({ ...record, withdrawal }), /do not withdraw again/);
  assert.match(namedNightStatus({ ...record, withdrawal, deposit }), new RegExp(deposit.hash));
  assert.match(namedNightStatus({ ...record, withdrawal, deposit }), /Reconcile those originals/);
});
