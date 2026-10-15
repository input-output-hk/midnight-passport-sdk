import assert from 'node:assert/strict';
import { test } from 'node:test';
import { p256 } from '@noble/curves/nist.js';
import {
  publishP256GrantBookkeeping,
  recoverPendingP256Grants,
} from '../packages/account/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

/** @param {Uint8Array} bytes */
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const account = 'ab'.repeat(32);
const grantId = 'cd'.repeat(32);
const key = { ...p256.Point.BASE.toAffine(), identity: false };
const policy = {
  rp_id_hash: new Uint8Array(32).fill(9),
  origin: new Uint8Array(21).fill(5),
};
const credentialId = Uint8Array.of(7);
const encKey = new Uint8Array(32).fill(8);
const seals = [0xa1, 0xa2, 0xa3].map((byte) => new Uint8Array(192).fill(byte));
const viewSeal = new Uint8Array(94).fill(0x42);
/** @type {import('../packages/account/dist/ports/index.js').GrantBookkeeping} */
const book = {
  grantId,
  slot: 0,
  scopeSalt: '09'.repeat(32),
  granteePublicKey: '10'.repeat(32),
  object: { color: '34'.repeat(32), recipient: { kind: 'any' }, maxCoinValue: '100' },
};
/** @type {import('../packages/account/dist/ports/index.js').AccountHint} */
const hint = {
  address: account,
  scheme: 'p256-webauthn',
  publicKey: key,
  credentialId,
  policy,
  status: 'active',
};

/** @param {Uint8Array[]} [initial] @param {boolean} [read] */
function fixture(initial = [], read = false) {
  /** @type {import('../packages/account/dist/jubjub-grant-issue.js').StagedJubjubGrant} */
  const opening = {
    account,
    origin: 'example.org',
    scope: {
      grantee: { scheme: 'jubjub-schnorr', publicKey: book.granteePublicKey },
      operations: ['withdraw-unshielded'],
      color: book.object.color,
      recipient: book.object.recipient,
      maxCoinValue: '100',
      perCallCap: '10',
      cap: '100',
      expiresAt: 2000,
      ...(read && { read: true, rpId: 'example.org', readPublicKey: '77'.repeat(32) }),
    },
    bookkeeping: { ...book, ...(read && { readPublicKey: '77'.repeat(32) }) },
    scopeDigest: '11'.repeat(32),
  };
  const inbox = [...initial];
  /** @type {string[]} */
  const calls = [];
  let nonce = 1n;
  let counter = 1n + BigInt(initial.length);
  let published = false;
  /** @type {import('../packages/account/dist/ports/index.js').AccountRecord} */
  let record = {
    address: account,
    bindingId: 'acc-s3r1.1',
    scheme: 'p256-webauthn',
    credentialId,
    localUseCounter: counter,
  };
  /** @param {bigint} count */
  const entry = (count) =>
    pureCircuits.derive_device_entry_with_p256(
      { bytes: Buffer.from(account, 'hex') },
      { ...key, identity: false },
      policy,
      0n,
      count,
    );
  /** @type {import('../packages/account/dist/p256-grant-publication.js').PublishP256GrantPorts} */
  const ports = {
    bindingId: 'acc-s3r1.1',
    networkId: 'undeployed',
    pure: pureCircuits,
    random: (length) => new Uint8Array(length).fill(3),
    sleep: async () => {},
    attempts: 2,
    grants: { readActiveGrantIds: async () => [grantId] },
    journal: {
      stage: async () => {},
      load: async () => opening,
      markPublished: async () => {
        published = true;
      },
    },
    records: {
      exists: async () => true,
      read: async () => record,
      write: async (next) => {
        record = next;
      },
    },
    viewingKey: {
      readerPublicKey: async () => new Uint8Array(32),
      createKeys: async () => ({ encKey, envelopes: [], registrations: [] }),
      sealToDevice: async () => ({ envelope: new Uint8Array(), registration: new Uint8Array() }),
      sealGrant: async () => {
        calls.push('seal');
        return seals.slice(0, 2);
      },
      sealView: async () => ({ entry: /** @type {Uint8Array} */ (seals[2]), seal: viewSeal }),
      openInbox: async (_networkId, _keyring, entries) =>
        entries.map((value) => {
          const part = seals.findIndex((seal) => hex(seal) === hex(value));
          if (part === 0)
            return {
              kind: 'grant',
              record: { ...opening.bookkeeping, part: /** @type {const} */ ('grant') },
            };
          if (part === 1)
            return {
              kind: 'grant',
              record: { part: /** @type {const} */ ('object'), grantId, object: book.object },
            };
          if (part === 2)
            return {
              kind: 'grant',
              record: {
                part: /** @type {const} */ ('view'),
                grantId,
                encKeyPrefix: hex(encKey).slice(0, 6),
                seal: hex(viewSeal),
              },
            };
          return null;
        }),
    },
    chain: {
      readAccount: async () => ({
        booted: true,
        specVersion: 3,
        authNonce: nonce,
        deviceEpoch: 0n,
        entryCount: 1,
        encKey,
        inboxEntries: [...inbox],
        deviceEntries: [entry(counter)],
        hasEntry: (value) => hex(value) === hex(entry(counter)),
      }),
      call: async (request) => {
        assert.equal(request.circuit, 'append_inbox_with_p256');
        assert.equal(/** @type {{use_counter: bigint}} */ (request.args[1]).use_counter, counter);
        calls.push('append');
        inbox.push(/** @type {Uint8Array} */ (request.args[0]));
        nonce++;
        counter++;
        return { txHash: `tx-${inbox.length}` };
      },
    },
    authoriser: {
      scheme: 'p256-webauthn',
      devicePublicKey: async () => key,
      deviceBinding: async () => ({ credentialId, policy }),
      withKeySession: async (operation, flow) => {
        assert.equal(flow?.kind, 'issue-grant');
        return operation();
      },
      authorise: async (request) => {
        assert.deepEqual(
          request.challenge,
          pureCircuits.challenge_append_inbox_with_p256(
            { bytes: Buffer.from(account, 'hex') },
            { ...key, identity: false },
            /** @type {Uint8Array} */ (request.args[0]),
            nonce,
          ),
        );
        return {
          scheme: 'p256-webauthn',
          pk: key,
          useCounter: request.useCounter,
          authenticatorData: new Uint8Array(37),
          sig: { r: 1n, s: 2n },
        };
      },
    },
  };
  return { ports, calls, inbox, published: () => published };
}

test('P-256 grant publication appends two seals and resumes without duplicate appends', async () => {
  const fresh = fixture();
  const result = await publishP256GrantBookkeeping({ hint, grantId }, fresh.ports);
  assert.deepEqual(result.appendTxHashes, ['tx-1', 'tx-2']);
  assert.equal(result.nextUseCounter, 3n);
  assert.equal(fresh.published(), true);
  const resumed = fixture(fresh.inbox);
  assert.deepEqual(
    (await publishP256GrantBookkeeping({ hint, grantId }, resumed.ports)).appendTxHashes,
    [],
  );
  assert.ok(!resumed.calls.includes('seal'));
});

test('P-256 read grant resumes its missing view seal', async () => {
  const pending = fixture(seals.slice(0, 2), true);
  const result = await publishP256GrantBookkeeping({ hint, grantId }, pending.ports);
  assert.deepEqual(result.appendTxHashes, ['tx-3']);
  assert.deepEqual(result.sealedReadGrant?.seal, viewSeal);
  assert.equal(pending.published(), true);
});

test('P-256 recovery publishes active pending grants and keeps absent issues staged', async () => {
  const world = fixture();
  const journal = { ...world.ports.journal, pending: async () => [grantId, 'ef'.repeat(32)] };
  const recovered = await recoverPendingP256Grants({ hint }, { ...world.ports, journal });
  assert.deepEqual(
    recovered.published.map((grant) => grant.grantId),
    [grantId],
  );
  assert.deepEqual(recovered.unsettledGrantIds, ['ef'.repeat(32)]);
  assert.equal(world.published(), true);
});

test('P-256 recovery refuses duplicate pending IDs before publication', async () => {
  const world = fixture();
  const journal = { ...world.ports.journal, pending: async () => [grantId, grantId] };
  await assert.rejects(recoverPendingP256Grants({ hint }, { ...world.ports, journal }), {
    code: 'GrantScopeInvalid',
  });
  assert.equal(world.inbox.length, 0);
});
