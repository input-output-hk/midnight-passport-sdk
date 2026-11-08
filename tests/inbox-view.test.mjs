import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accountInboxReader, hasInbox } from '../packages/account/dist/inbox-view.js';

const view = () => ({
  booted: true,
  authNonce: 0n,
  deviceEpoch: 0n,
  entryCount: 0,
  specVersion: 3,
  hasEntry: () => false,
  encKey: new Uint8Array(32),
  inboxEntries: [],
  deviceEntries: [],
});

test('typed inbox reads preserve the port snapshot and request devices only when needed', async () => {
  const snapshot = view();
  const requests = /** @type {unknown[]} */ ([]);
  const read = accountInboxReader(async () => ({
    async readAccount(address, options) {
      requests.push({ address, options });
      return snapshot;
    },
  }));
  assert.equal(await read({ address: 'ab'.repeat(32) }), snapshot);
  assert.equal(await read({ address: 'ab'.repeat(32) }, true), snapshot);
  assert.deepEqual(requests, [
    { address: 'ab'.repeat(32), options: { includeInbox: true } },
    { address: 'ab'.repeat(32), options: { includeInbox: true, includeDevices: true } },
  ]);
});

test('missing inbox/device data refuses before downstream key operations, retaining original guard behavior', async () => {
  /** @type {import('../packages/account/dist/ports/index.js').AccLedgerView|undefined} */
  let snapshot;
  const read = accountInboxReader(async () => ({ readAccount: async () => snapshot }));
  await assert.rejects(read({ address: 'ab'.repeat(32) }), { code: 'AccountNotFound' });
  const { encKey: _encKey, inboxEntries: _inbox, deviceEntries: _devices, ...publicOnly } = view();
  void [_encKey, _inbox, _devices];
  snapshot = publicOnly;
  await assert.rejects(read({ address: 'ab'.repeat(32) }), { code: 'BindingUnsupported' });
  snapshot = { ...publicOnly, encKey: new Uint8Array(32), inboxEntries: [] };
  assert.equal(hasInbox(snapshot), true);
  assert.equal(await read({ address: 'ab'.repeat(32) }), snapshot);
  await assert.rejects(read({ address: 'ab'.repeat(32) }, true), { code: 'BindingUnsupported' });
});
