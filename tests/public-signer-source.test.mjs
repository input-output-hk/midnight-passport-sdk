import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MessageChannel } from 'node:worker_threads';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  signerDependencyRange,
  signerRelativeFile,
  signerBundleTree,
  verifyPublicSigner,
} from '../scripts/consumer/public-signer-source.mjs';
import {
  createSignerWindowPair,
  SIGNER_ORIGIN,
  SIGNER_DAPP_ORIGIN,
} from '../scripts/qualification/signer-windows.mjs';

test('public source resolver rejects escapes and dependency ranges do not admit a wrong release', () => {
  assert.throws(() => signerRelativeFile('/source', '/source/../private/handler.ts'));
  assert.throws(() => signerRelativeFile('/source', '/source/node_modules/handler.ts'));
  assert.equal(signerDependencyRange('^1.8.0', '2.2.0'), false);
  assert.equal(signerDependencyRange('^0.2.1', '0.3.0'), false);
  assert.equal(signerDependencyRange('^0.2.1', '0.2.2'), true);
  assert.equal(signerDependencyRange('^0.0.1', '0.0.2'), false);
  assert.equal(signerDependencyRange('^1.8.0', '1.9.0'), true);
  assert.equal(signerDependencyRange('^1.8.0', '1.7.9'), false);
  assert.equal(signerDependencyRange('^1.8.0', '1.9.0-rc1'), false);
  assert.equal(signerDependencyRange('1.9.0-rc1', '1.9.0-rc1'), true);
});
test('bundle byte changes are visible and symlinks cannot redirect executable inputs', () => {
  const root = mkdtempSync(join(tmpdir(), 'signer-bundle-'));
  try {
    mkdirSync(join(root, 'bundle'));
    writeFileSync(join(root, 'bundle/handlers.mjs'), 'export const value=1;');
    const before = signerBundleTree(join(root, 'bundle'));
    writeFileSync(join(root, 'bundle/handlers.mjs'), 'export const value=2;');
    assert.notDeepEqual(signerBundleTree(join(root, 'bundle')), before);
    symlinkSync(join(root, 'bundle/handlers.mjs'), join(root, 'bundle/extra.mjs'));
    assert.throws(() => signerBundleTree(join(root, 'bundle')), /links/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('externally pinned signer configuration is refused before any untrusted path is visited', () => {
  const root = mkdtempSync(join(tmpdir(), 'signer-config-'));
  try {
    const body = JSON.stringify({
      source: { root: '/untrusted/source' },
      consumer: { root: '/untrusted/consumer' },
    });
    writeFileSync(join(root, 'signer-inputs.json'), body);
    assert.throws(
      () => verifyPublicSigner(root, 'aa'.repeat(32), '/untrusted/sdk'),
      /configuration pin changed/,
    );
    assert.equal(readFileSync(join(root, 'signer-inputs.json'), 'utf8'), body);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('simulated window routing respects target origins and retains native MessagePort exchange', async () => {
  const w = createSignerWindowPair(),
    channel = new MessageChannel();
  let received = false;
  const listener = (/** @type {any} */ event) => {
    assert.equal(event.origin, SIGNER_DAPP_ORIGIN);
    assert.equal(event.source, w.opener);
    assert.equal(event.ports[0], channel.port2);
    event.ports[0].postMessage('ack');
    received = true;
  };
  w.signerHost.addEventListener('message', listener);
  w.popup.postMessage('wrong', 'https://untrusted.example', [channel.port2]);
  await Promise.resolve();
  assert.equal(received, false);
  const ack = new Promise((resolve) => channel.port1.once('message', resolve));
  w.popup.postMessage('right', SIGNER_ORIGIN, [channel.port2]);
  assert.equal(await ack, 'ack');
  w.signerHost.removeEventListener('message', listener);
  channel.port1.close();
  channel.port2.close();
  assert.deepEqual(w.listenerCounts(), { dapp: 0, signer: 0 });
});
