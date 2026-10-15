import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readQualifiedHolding } from '../packages/account/dist/holdings.js';

const account = 'ab'.repeat(32);
const encKey = new Uint8Array(32).fill(3);
const color = new Uint8Array(32).fill(4);
const heldCoin = { nonce: new Uint8Array(32).fill(5), color, value: 12n, mt_index: 7n };
const entries = [Uint8Array.of(1), Uint8Array.of(2)];
const keyring = { account, encKey, envelopes: [...entries].reverse() };

function ports({ coin = heldCoin, liveKey = encKey } = {}) {
  return {
    networkId: 'undeployed',
    chain: {
      readAccount: async () => ({ encKey: liveKey, inboxEntries: entries }),
      call: async () => ({ txHash: 'unused' }),
    },
    viewingKey: {
      openInbox: async () => [null, { kind: /** @type {const} */ ('coin'), coin: heldCoin }],
    },
    holdings: {
      selectQualifiedHeldCoins: async () => [{ inboxIndex: 1, coin }],
      selectHeldEntries: async () => [1],
    },
  };
}

test('qualified selection binds the requested inbox entry, opened coin, live key and asset', async () => {
  const input = { account, keyring, inboxIndex: 1, color };
  const selected = await readQualifiedHolding(input, ports());
  assert.deepEqual(selected, heldCoin);
  assert.notEqual(selected.nonce, heldCoin.nonce);
  await assert.rejects(readQualifiedHolding({ ...input, inboxIndex: 0 }, ports()), {
    code: 'TransferInvalid',
  });
  await assert.rejects(readQualifiedHolding({ ...input, color: new Uint8Array(32) }, ports()), {
    code: 'TransferInvalid',
  });
  await assert.rejects(readQualifiedHolding(input, ports({ liveKey: new Uint8Array(32) })), {
    code: 'EncryptionKeyMismatch',
  });
  await assert.rejects(
    readQualifiedHolding(input, ports({ coin: { ...heldCoin, mt_index: -1n } })),
    { code: 'TransferInvalid' },
  );
});
