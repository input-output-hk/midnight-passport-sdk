import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionAssetName, sessionPresentation } from '../src/session-view.js';
import type { DemoSessionSnapshot } from '../src/session.js';

test('asset labels identify NIGHT exactly and do not relabel unknown assets', () => {
  assert.equal(sessionAssetName('00'.repeat(32)), 'NIGHT');
  assert.match(sessionAssetName('01'.repeat(32)), /^Token /);
  assert.ok(!sessionAssetName('01'.repeat(32)).includes('NIGHT'));
  assert.equal(sessionAssetName(), 'Not selected');
});

test('local lock and local expiry retain the on-chain grant warning', () => {
  for (const status of ['locked', 'expired'] as const) {
    const view = sessionPresentation({ status, spent: '2', grantId: 'a'.repeat(64) });
    assert.match(view.grantNotice, /copied key/);
    assert.match(view.grantNotice, /Local lock is not revocation/);
  }
  assert.equal(sessionPresentation({ status: 'locked', spent: '0' }).grantNotice, '');
});

test('unknown, pending and confirmed revocation describe different authority boundaries', () => {
  const view = (status: DemoSessionSnapshot['status']) =>
    sessionPresentation({ status, spent: '0' });
  assert.match(view('blocked').message, /Do not retry/);
  assert.match(view('blocked').message, /original intent/);
  assert.match(view('revoking').message, /Wait for on-chain confirmation/);
  assert.match(view('revoked').message, /confirmed on chain/);
  assert.match(view('revoked').message, /not undone/);
  assert.match(view('spending').message, /Do not send a replacement/);
});
