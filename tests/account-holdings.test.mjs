import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readVerifiedHoldings } from '../packages/account/dist/index.js';

const key = Uint8Array.of(1, 2, 3);
const coin = { nonce: Uint8Array.of(7), color: Uint8Array.of(8), value: 9n };
const entries = [Uint8Array.of(10), Uint8Array.of(11), Uint8Array.of(12)];
/** @type {(import('../packages/account/dist/ports/index.js').OpenedInboxEntry | null)[]} */
const opened = [
  null,
  { kind: 'coin', coin },
  { kind: 'device', device: { readerPublicKey: 'aa', devicePublicKey: 'bb' } },
];
const input = { account: 'acc', keyring: { account: 'acc', encKey: key, envelopes: [] } };

/** @param {number[]} indices @param {typeof entries} [inbox] */
function fixture(indices, inbox = entries) {
  /** @type {string[]} */
  const sessions = [];
  /** @type {import('../packages/account/dist/holdings.js').ReadVerifiedHoldingsPorts} */
  const ports = {
    networkId: 'local',
    chain: {
      call: async () => ({ txHash: 'unused' }),
      readAccount: async () => ({
        booted: true,
        authNonce: 0n,
        deviceEpoch: 0n,
        entryCount: 1,
        specVersion: 3,
        encKey: key,
        inboxEntries: inbox,
        hasEntry: () => true,
      }),
    },
    authoriser: {
      withKeySession: async (operation, flow) => {
        sessions.push(flow?.kind ?? 'missing');
        return operation();
      },
    },
    viewingKey: {
      readerPublicKey: async () => new Uint8Array(32),
      createKeys: async () => ({ encKey: key, envelopes: [], registrations: [] }),
      sealToDevice: async () => ({ envelope: new Uint8Array(), registration: new Uint8Array() }),
      openInbox: async () => opened.slice(0, inbox.length),
      sealGrant: async () => [],
    },
    holdings: {
      selectHeldEntries: async () => indices,
    },
  };
  return { ports, sessions };
}

test('readVerifiedHoldings returns only chain-confirmed coins under one read session', async () => {
  const { ports, sessions } = fixture([1]);
  assert.deepEqual(await readVerifiedHoldings(input, ports), [{ inboxIndex: 1, coin }]);
  assert.deepEqual(sessions, ['read-holdings']);
});

test('empty inbox needs no key session', async () => {
  const { ports, sessions } = fixture([], []);
  assert.deepEqual(await readVerifiedHoldings(input, ports), []);
  assert.deepEqual(sessions, []);
});

test('wrong account or stale encryption key fails before opening the inbox', async () => {
  const { ports, sessions } = fixture([1]);
  await assert.rejects(readVerifiedHoldings({ account: 'other', keyring: input.keyring }, ports), {
    code: 'NotAuthorised',
  });
  await assert.rejects(
    readVerifiedHoldings(
      { account: 'acc', keyring: { ...input.keyring, encKey: Uint8Array.of(0) } },
      ports,
    ),
    { code: 'EncryptionKeyMismatch' },
  );
  assert.deepEqual(sessions, []);
});

test('a chain source cannot select duplicates, out-of-range indices or non-coins', async () => {
  for (const indices of [[1, 1], [9], [-1], [0], [2]]) {
    const { ports } = fixture(indices);
    await assert.rejects(readVerifiedHoldings(input, ports), { code: 'InternalError' });
  }
});

test('nonempty reads require an explicit key-session host', async () => {
  const { ports } = fixture([1]);
  await assert.rejects(readVerifiedHoldings(input, { ...ports, authoriser: {} }), {
    code: 'BindingUnsupported',
  });
});
