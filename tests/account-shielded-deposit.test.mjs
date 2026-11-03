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
  await assert.rejects(depositShielded(request, ports), {
    code: 'MutationUnsettled',
    retryable: false,
    message: /tx-pending.*reconcile before retrying/,
  });
  reader.secretKey.fill(0);
});

test('invalid deposit timing options refuse before chain, sealer or sender work', async () => {
  const forbidden = async () => {
    throw Error('side effect must not run');
  };
  for (const value of [NaN, Infinity, -Infinity, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      () =>
        depositShielded(request, {
          chain: { readAccount: forbidden },
          sealCoin: forbidden,
          sender: { depositShielded: forbidden },
          sleep: forbidden,
          pollMs: value,
        }),
      /Invalid deposit confirmation window/,
    );
  }
  for (const value of [NaN, Infinity, -Infinity, -1, 1.5, 2_147_483_648]) {
    await assert.rejects(
      () =>
        depositShielded(request, {
          chain: { readAccount: forbidden },
          sealCoin: forbidden,
          sender: { depositShielded: forbidden },
          sleep: forbidden,
          pollMs: 1,
          confirmationMs: value,
        }),
      /Invalid deposit confirmation window/,
    );
  }
});

test('one-shot sender uncertainty and later port failures are nonretryable and keep original identity', async () => {
  const key = x25519.getPublicKey(new Uint8Array(32).fill(9));
  for (const fault of ['sender', 'reply', 'read', 'sleep']) {
    let sends = 0;
    /** @type {import('../packages/account/dist/index.js').ShieldedDepositPorts} */
    const ports = {
      chain: {
        readAccount: async (_address, options) => {
          if (sends && fault === 'read') throw Error('private observer diagnostic');
          return ledger(key, options?.includeInbox ? [] : undefined);
        },
      },
      sealCoin: sealInboxCoin,
      sender: {
        depositShielded: async () => {
          sends++;
          if (fault === 'sender') throw Error('private sender diagnostic');
          return { txId: fault === 'reply' ? '' : 'tx-retained' };
        },
      },
      sleep: async () => {
        throw Error('private sleep diagnostic');
      },
      pollMs: 1,
      confirmationMs: 2,
    };
    await assert.rejects(depositShielded(request, ports), (error) => {
      assert.ok(error && typeof error === 'object' && 'code' in error && 'retryable' in error);
      assert.equal(error.code, 'MutationUnsettled');
      assert.equal(error.retryable, false);
      assert.ok(String(error).includes(request.requestId));
      assert.equal(String(error).includes('private'), false);
      if (fault === 'read' || fault === 'sleep') assert.ok(String(error).includes('tx-retained'));
      return true;
    });
    assert.equal(sends, 1);
  }
});

test('opaque sender IDs retain dotted and base64 punctuation without altering the result', async () => {
  const key = x25519.getPublicKey(new Uint8Array(32).fill(9));
  for (const txId of ['v1.tx:alpha_beta-9', 'v1.+/digest==', 'tx~percent%20id']) {
    /** @type {Uint8Array|undefined} */ let entry;
    /** @type {import('../packages/account/dist/index.js').ShieldedDepositPorts} */
    const ports = {
      chain: {
        readAccount: async (_address, options) =>
          ledger(key, options?.includeInbox ? (entry ? [entry] : []) : undefined),
      },
      sealCoin: sealInboxCoin,
      sender: {
        depositShielded: async (call) => {
          entry = call.entry;
          return { txId };
        },
      },
      sleep: async () => {},
      pollMs: 1,
    };
    const result = await depositShielded(request, ports);
    assert.equal(result.txId, txId);
  }
});
