import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publishJubjubGrantBookkeeping } from '../packages/account/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

/** @param {Uint8Array} bytes */
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const account = 'ab'.repeat(32);
const grantId = 'cd'.repeat(32);
const owner = pureCircuits.compute_public_point_with_jubjub(7n);
const encKey = new Uint8Array(32).fill(8);
const header = new Uint8Array(192).fill(0xa1);
const object = new Uint8Array(192).fill(0xa2);
/** @type {import('../packages/account/dist/ports/index.js').GrantBookkeeping} */
const book = {
  grantId,
  slot: 0,
  scopeSalt: '09'.repeat(32),
  granteePublicKey: '10'.repeat(32),
  object: { color: '34'.repeat(32), recipient: { kind: 'any' }, maxCoinValue: '100' },
};
/** @type {import('../packages/account/dist/jubjub-grant-issue.js').StagedJubjubGrant} */
const staged = {
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
  },
  bookkeeping: book,
  scopeDigest: '11'.repeat(32),
};
const hint = {
  address: account,
  scheme: /** @type {const} */ ('jubjub-schnorr'),
  publicKey: owner,
  credentialId: Uint8Array.of(10),
  status: /** @type {const} */ ('active'),
};

/** @param {Uint8Array[]} [initialInbox] */
function fixture(initialInbox = []) {
  /** @type {string[]} */
  const calls = [];
  /** @type {Uint8Array[]} */
  const inbox = [...initialInbox];
  let nonce = 1n;
  let counter = BigInt(initialInbox.length ? 2 : 1);
  let published = false;
  let active = true;
  /** @type {import('../packages/account/dist/ports/index.js').AccountRecord} */
  let record = {
    address: account,
    bindingId: 'acc-s3r1.1',
    scheme: /** @type {const} */ ('jubjub-schnorr'),
    credentialId: Uint8Array.of(10),
    localUseCounter: counter,
  };
  /** @type {import('../packages/account/dist/jubjub-grant-publication.js').PublishJubjubGrantPorts} */
  const ports = {
    bindingId: 'acc-s3r1.1',
    networkId: 'undeployed',
    pure: pureCircuits,
    random: (length) => new Uint8Array(length).fill(3),
    sleep: async () => {},
    attempts: 2,
    grants: {
      readActiveGrantIds: async () => {
        calls.push('roster');
        return active ? [grantId] : [];
      },
    },
    journal: {
      stage: async () => {},
      load: async () => {
        calls.push('load');
        return staged;
      },
      markPublished: async () => {
        calls.push('published');
        published = true;
      },
    },
    records: {
      exists: async () => true,
      read: async () => record,
      write: async (next) => {
        calls.push('record');
        record = next;
      },
    },
    viewingKey: {
      decodeDevicePublicKey: () => owner,
      readerPublicKey: async () => new Uint8Array(32),
      createKeys: async () => ({ encKey, envelopes: [], registrations: [] }),
      sealToDevice: async () => ({ envelope: new Uint8Array(), registration: new Uint8Array() }),
      sealGrant: async () => {
        calls.push('seal');
        return [header, object];
      },
      openInbox: async (_networkId, keyring, entries) => {
        assert.deepEqual(keyring.encKey, encKey);
        return entries.map((entry) => {
          if (hex(entry) === hex(header))
            return {
              kind: 'grant',
              record: {
                part: 'grant',
                grantId,
                slot: 0,
                scopeSalt: book.scopeSalt,
                granteePublicKey: book.granteePublicKey,
              },
            };
          if (hex(entry) === hex(object))
            return { kind: 'grant', record: { part: 'object', grantId, object: book.object } };
          return null;
        });
      },
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
        hasEntry: (entry) =>
          hex(entry) ===
          hex(
            pureCircuits.derive_device_entry_with_jubjub(
              { bytes: Buffer.from(account, 'hex') },
              owner,
              0n,
              counter,
            ),
          ),
      }),
      call: async (request) => {
        calls.push('append');
        assert.equal(request.circuit, 'append_inbox_with_jubjub');
        const entry = /** @type {Uint8Array} */ (request.args[0]);
        assert.equal(request.args[2], counter);
        inbox.push(entry);
        nonce++;
        counter++;
        return { txHash: `tx-${inbox.length}` };
      },
    },
    authoriser: {
      scheme: 'jubjub-schnorr',
      devicePublicKey: async () => owner,
      withKeySession: async (operation, flow) => {
        calls.push('session');
        assert.equal(flow?.kind, 'issue-grant');
        return operation();
      },
      authorise: async (request) => {
        calls.push('sign');
        if (typeof request.challenge !== 'function') throw new Error('missing challenge');
        assert.deepEqual(
          request.challenge(owner, 3n),
          pureCircuits.challenge_append_inbox_with_jubjub(
            { bytes: Buffer.from(account, 'hex') },
            owner,
            owner,
            /** @type {Uint8Array} */ (request.args[0]),
            nonce,
            3n,
          ),
        );
        return {
          scheme: 'jubjub-schnorr',
          pk: owner,
          useCounter: request.useCounter,
          sigR: owner,
          sigS: 8n,
          grindNonce: 3n,
        };
      },
    },
  };
  return { ports, calls, inbox, published: () => published, revoke: () => (active = false) };
}

test('confirmed grant publishes two sealed parts and marks its journal complete', async () => {
  const { ports, calls, inbox, published } = fixture();
  const result = await publishJubjubGrantBookkeeping({ hint, grantId }, ports);
  assert.equal(result.status, 'active');
  assert.deepEqual(result.appendTxHashes, ['tx-1', 'tx-2']);
  assert.equal(result.nextUseCounter, 3n);
  assert.deepEqual(inbox, [header, object]);
  assert.equal(published(), true);
  assert.ok(calls.indexOf('published') > calls.lastIndexOf('append'));
});

test('retry appends only the missing object; a fully published inbox is a no-op', async () => {
  const partial = fixture([header]);
  const resumed = await publishJubjubGrantBookkeeping({ hint, grantId }, partial.ports);
  assert.deepEqual(resumed.appendTxHashes, ['tx-2']);
  assert.deepEqual(partial.inbox, [header, object]);
  const complete = fixture([header, object]);
  const repeated = await publishJubjubGrantBookkeeping({ hint, grantId }, complete.ports);
  assert.deepEqual(repeated.appendTxHashes, []);
  assert.ok(!complete.calls.includes('append'));
  assert.ok(!complete.calls.includes('seal'));
  assert.equal(complete.published(), true);
});

test('unrelated seals are rejected before an ACC append', async () => {
  const { ports, calls } = fixture();
  ports.viewingKey.sealGrant = async () => [object, header];
  await assert.rejects(publishJubjubGrantBookkeeping({ hint, grantId }, ports), {
    code: 'InternalError',
  });
  assert.ok(!calls.includes('append'));
});

test('unsettled or revoked grant does not publish bookkeeping', async () => {
  const { ports, calls, revoke } = fixture();
  revoke();
  await assert.rejects(publishJubjubGrantBookkeeping({ hint, grantId }, ports), {
    code: 'GrantRosterUnsettled',
  });
  assert.ok(!calls.includes('session'));
  assert.ok(!calls.includes('append'));
});

test('revocation during publication leaves the journal staged', async () => {
  const { ports, calls, published, revoke } = fixture();
  const append = ports.chain.call;
  ports.chain.call = async (request) => {
    const result = await append(request);
    if (calls.filter((call) => call === 'append').length === 2) revoke();
    return result;
  };
  await assert.rejects(publishJubjubGrantBookkeeping({ hint, grantId }, ports), {
    code: 'GrantRevoked',
  });
  assert.equal(published(), false);
  assert.ok(!calls.includes('published'));
});
