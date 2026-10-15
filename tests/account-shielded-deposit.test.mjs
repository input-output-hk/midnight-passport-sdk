import assert from 'node:assert/strict';
import { test } from 'node:test';
import { x25519 } from '@noble/curves/ed25519.js';
import { depositShielded } from '../packages/account/dist/index.js';
import { sealInboxCoin } from '../packages/keys/dist/index.js';
import { openInboxCoin } from '../packages/keys/dist/inbox-coin.js';

const account = 'ab'.repeat(32);
const request = {
  account,
  requestId: '12345678-1234-1234-1234-123456789abc',
  color: new Uint8Array(32).fill(2),
  nonce: new Uint8Array(32).fill(3),
  amount: 27n,
};

/** @param {Uint8Array} encKey @param {readonly Uint8Array[]} [inboxEntries] */
const ledger = (encKey, inboxEntries) => ({
  specVersion: 3,
  booted: true,
  authNonce: 0n,
  deviceEpoch: 0n,
  entryCount: 1,
  encKey,
  ...(inboxEntries ? { inboxEntries } : {}),
  hasEntry: () => true,
});

test('shielded deposit seals the pinned call and confirms its live ACC inbox entry', async () => {
  const reader = x25519.keygen();
  /** @type {Uint8Array[]} */
  const entries = [new Uint8Array(192).fill(9)];
  /** @type {Array<{requestId: string, account: string, coin: import('../packages/account/dist/ports/index.js').ShieldedCoin, entry: Uint8Array}>} */
  const calls = [];
  let readsAfterSubmit = 0;
  /** @type {import('../packages/account/dist/index.js').ShieldedDepositPorts} */
  const ports = {
    chain: {
      async readAccount(_address, options) {
        if (calls[0] && ++readsAfterSubmit === 2) entries.push(calls[0].entry);
        return ledger(reader.publicKey, options?.includeInbox ? entries.slice() : undefined);
      },
    },
    sealCoin: sealInboxCoin,
    sender: {
      async depositShielded(call) {
        calls.push(call);
        return { txId: 'tx-1' };
      },
    },
    sleep: async () => {},
    pollMs: 1,
  };
  const result = await depositShielded(request, ports);
  assert.deepEqual(result, { txId: 'tx-1', inboxIndex: 1, viewingKeyChanged: false });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.requestId, request.requestId);
  assert.equal(call.account, account);
  assert.deepEqual(call.coin, {
    nonce: request.nonce,
    color: request.color,
    value: request.amount,
  });
  assert.deepEqual(await openInboxCoin(reader.secretKey, call.entry), call.coin);
  reader.secretKey.fill(0);
});

test('shielded deposit refuses an unsupported ACC and an enc_key rotation before wallet spend', async () => {
  const reader = x25519.keygen();
  let reads = 0;
  let spends = 0;
  const chain = {
    async readAccount() {
      reads++;
      return ledger(reads === 1 ? reader.publicKey : new Uint8Array(32).fill(8), []);
    },
  };
  /** @type {import('../packages/account/dist/index.js').ShieldedDepositPorts} */
  const ports = {
    chain,
    sealCoin: sealInboxCoin,
    sender: {
      async depositShielded() {
        spends++;
        return { txId: 'tx-1' };
      },
    },
    sleep: async () => {},
  };
  await assert.rejects(depositShielded(request, ports), { code: 'EncryptionKeyMismatch' });
  assert.equal(spends, 0);
  await assert.rejects(depositShielded({ ...request, amount: 0n }, ports), /Invalid shielded/);
  assert.equal(spends, 0);
  chain.readAccount = async () => ({ ...ledger(reader.publicKey, []), specVersion: 2 });
  await assert.rejects(depositShielded(request, ports), { code: 'BindingUnsupported' });
  assert.equal(spends, 0);
  reader.secretKey.fill(0);
});

test('an unconfirmed shielded deposit preserves its transaction ID for reconciliation', async () => {
  const reader = x25519.keygen();
  let clock = 0;
  /** @type {import('../packages/account/dist/index.js').ShieldedDepositPorts} */
  const ports = {
    chain: {
      async readAccount(_address, options) {
        return ledger(reader.publicKey, options?.includeInbox ? [] : undefined);
      },
    },
    sealCoin: sealInboxCoin,
    sender: { depositShielded: async () => ({ txId: 'tx-pending' }) },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    pollMs: 1,
    confirmationMs: 2,
  };
  await assert.rejects(depositShielded(request, ports), /tx-pending.*reconcile before retrying/);
  reader.secretKey.fill(0);
});
