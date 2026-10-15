import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jubjub } from '@noble/curves/misc.js';
import {
  issueAndPublishJubjubGrant,
  issueJubjubGrantCall,
} from '../packages/account/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

/** @param {Uint8Array} bytes */
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const account = 'ab'.repeat(32);
const owner = pureCircuits.compute_public_point_with_jubjub(7n);
const grantee = hex(
  jubjub.Point.fromAffine(pureCircuits.compute_public_point_with_jubjub(11n)).toBytes(),
);
const record = {
  address: account,
  bindingId: 'acc-s3r1.1',
  scheme: /** @type {const} */ ('jubjub-schnorr'),
  credentialId: Uint8Array.of(10),
  localUseCounter: 0n,
};
const hint = {
  address: account,
  scheme: /** @type {const} */ ('jubjub-schnorr'),
  publicKey: owner,
  credentialId: Uint8Array.of(10),
  status: /** @type {const} */ ('active'),
};
/** @type {import('../packages/account/dist/grant-scope.js').GrantScopeInput} */
const scope = {
  grantee: { scheme: 'jubjub-schnorr', publicKey: grantee },
  operations: ['withdraw-unshielded'],
  color: '34'.repeat(32),
  recipient: { kind: 'any' },
  maxCoinValue: '100',
  perCallCap: '10',
  cap: '100',
  expiresAt: 2000,
};
const input = { hint, origin: 'example.org', scope };

function fixture() {
  /** @type {string[]} */
  const calls = [];
  let grantNonce = 5n;
  /** @type {string[]} */
  let activeIds = [];
  /** @type {import('../packages/account/dist/jubjub-grant-issue.js').StagedJubjubGrant[]} */
  const staged = [];
  /** @type {import('../packages/account/dist/jubjub-grant-issue.js').IssueJubjubGrantCallPorts} */
  const ports = {
    bindingId: 'acc-s3r1.1',
    pure: pureCircuits,
    random: (length) => new Uint8Array(length).fill(9),
    nowSeconds: () => 1000,
    records: {
      read: async () => {
        calls.push('record-read');
        return record;
      },
      exists: async () => {
        calls.push('presence');
        return true;
      },
      write: async (next) => {
        calls.push('record');
        assert.equal(next.localUseCounter, 1n);
      },
    },
    grants: {
      readActiveGrantIds: async (address) => {
        assert.equal(address, account);
        return activeIds;
      },
      readActiveGrantSnapshot: async (address) => {
        calls.push('roster');
        assert.equal(address, account);
        return { authNonce: grantNonce, ids: activeIds };
      },
    },
    journal: {
      stage: async (grant) => {
        calls.push('stage');
        staged.push(grant);
        assert.equal(grant.bookkeeping.scopeSalt, '09'.repeat(32));
      },
    },
    chain: {
      readAccount: async () => {
        calls.push('ledger');
        return {
          booted: true,
          specVersion: 3,
          authNonce: 5n,
          deviceEpoch: 0n,
          entryCount: 1,
          hasEntry: (entry) =>
            hex(entry) ===
            hex(
              pureCircuits.derive_device_entry_with_jubjub(
                { bytes: Buffer.from(account, 'hex') },
                owner,
                0n,
                0n,
              ),
            ),
        };
      },
      call: async (request) => {
        calls.push('call');
        assert.equal(request.circuit, 'issue_grant_with_jubjub');
        assert.equal(request.args.length, 23);
        assert.equal(
          hex(/** @type {Uint8Array} */ (request.args[0])),
          staged[0]?.bookkeeping.grantId,
        );
        assert.equal(request.args[19], 0n);
        return { txHash: 'tx' };
      },
    },
    authoriser: {
      scheme: 'jubjub-schnorr',
      devicePublicKey: async () => owner,
      withKeySession: async (operation, flow) => {
        calls.push('session');
        assert.equal(flow?.kind, 'issue-grant');
        assert.equal(flow?.account, account);
        assert.equal(flow?.scopeSalt, '09'.repeat(32));
        assert.equal(flow?.slot, 0);
        assert.equal(flow?.scope, scope);
        assert.equal(flow?.scopeDigest?.length, 64);
        return operation();
      },
      authorise: async (request) => {
        calls.push('sign');
        assert.equal(request.circuit, 'issue_grant_with_jubjub');
        assert.equal(request.useCounter, 0n);
        if (typeof request.challenge !== 'function') throw new Error('missing challenge builder');
        const actual = request.challenge(owner, 3n);
        const grantId = /** @type {Uint8Array} */ (request.args[0]);
        const salt = /** @type {Uint8Array} */ (request.args.at(-1));
        const scopeArgs =
          /** @type {import('../packages/account/dist/grant-scope.js').GrantScopeArgs} */ (
            /** @type {unknown} */ (request.args.slice(1, -1))
          );
        const expected = pureCircuits.challenge_issue_grant_with_jubjub(
          { bytes: Buffer.from(account, 'hex') },
          owner,
          owner,
          grantId,
          pureCircuits.derive_grant_scope_digest(salt, ...scopeArgs),
          5n,
          3n,
        );
        assert.deepEqual(actual, expected);
        return {
          scheme: 'jubjub-schnorr',
          pk: owner,
          useCounter: 0n,
          sigR: owner,
          sigS: 8n,
          grindNonce: 3n,
        };
      },
    },
  };
  return {
    ports,
    calls,
    staged,
    setGrantNonce: (/** @type {bigint} */ value) => (grantNonce = value),
    setActiveIds: (/** @type {string[]} */ value) => (activeIds = value),
  };
}

test('issue call stages the grant opening before submission and advances the owner counter', async () => {
  const { ports, calls, staged } = fixture();
  const result = await issueJubjubGrantCall(input, ports);
  assert.equal(result.status, 'submitted');
  assert.equal(result.txHash, 'tx');
  assert.equal(result.grantId, staged[0]?.bookkeeping.grantId);
  assert.deepEqual(calls, [
    'presence',
    'ledger',
    'roster',
    'session',
    'record-read',
    'sign',
    'roster',
    'stage',
    'call',
    'record',
  ]);
});

test('an indexer roster nonce behind the signing view is refused before consent', async () => {
  const { ports, calls, setGrantNonce } = fixture();
  setGrantNonce(4n);
  await assert.rejects(issueJubjubGrantCall(input, ports), { code: 'GrantRosterUnsettled' });
  assert.deepEqual(calls, ['presence', 'ledger', 'roster']);
});

test('a grant roster changed while signing is refused before staging or submission', async () => {
  const { ports, calls, setGrantNonce } = fixture();
  const sign = ports.authoriser.authorise;
  ports.authoriser.authorise = async (request) => {
    const result = await sign(request);
    setGrantNonce(6n);
    return result;
  };
  await assert.rejects(issueJubjubGrantCall(input, ports), { code: 'GrantRosterUnsettled' });
  assert.ok(!calls.includes('stage'));
  assert.ok(!calls.includes('call'));
});

test('a changed active ID set at the same nonce is refused before staging', async () => {
  const { ports, calls, setActiveIds } = fixture();
  const sign = ports.authoriser.authorise;
  ports.authoriser.authorise = async (request) => {
    const result = await sign(request);
    setActiveIds(['ef'.repeat(32)]);
    return result;
  };
  await assert.rejects(issueJubjubGrantCall(input, ports), { code: 'GrantRosterUnsettled' });
  assert.ok(!calls.includes('stage'));
});

test('a journal failure stops the proof call, leaving the counter unchanged', async () => {
  const { ports, calls } = fixture();
  ports.journal.stage = async () => {
    throw new Error('storage unavailable');
  };
  await assert.rejects(issueJubjubGrantCall(input, ports), { code: 'InternalError' });
  assert.ok(!calls.includes('call'));
  assert.ok(!calls.includes('record'));
});

test('a missing local record is refused before key session or chain work', async () => {
  const { ports, calls } = fixture();
  ports.records.exists = async () => false;
  await assert.rejects(issueJubjubGrantCall(input, ports), { code: 'AccountNotFound' });
  assert.deepEqual(calls, []);
});

test('read and shielded grants are refused before a key ceremony', async () => {
  for (const changed of [
    { ...scope, read: true, rpId: 'example.org', readPublicKey: '12'.repeat(32) },
    { ...scope, operations: /** @type {const} */ (['withdraw-shielded']) },
  ]) {
    const { ports, calls } = fixture();
    await assert.rejects(issueJubjubGrantCall({ ...input, scope: changed }, ports), {
      code: 'BindingUnsupported',
    });
    assert.deepEqual(calls, []);
  }
});

test('settled issue returns active only after both sealed grant parts are confirmed', async () => {
  const { ports, staged, setActiveIds } = fixture();
  /** @type {Uint8Array[]} */
  const inbox = [];
  const sealed = [new Uint8Array(192).fill(0xa1), new Uint8Array(192).fill(0xa2)];
  /** @type {import('../packages/account/dist/ports/index.js').AccountRecord} */
  let current = record;
  let nonce = 5n;
  let published = false;
  const opening = () => {
    const value = staged[0];
    assert.ok(value);
    return value;
  };
  const issueCall = ports.chain.call;
  const issueSign = ports.authoriser.authorise;
  /** @type {import('../packages/account/dist/jubjub-grant-settlement.js').IssueAndPublishJubjubGrantPorts} */
  const settled = {
    ...ports,
    pure: pureCircuits,
    networkId: 'undeployed',
    attempts: 2,
    sleep: async () => {},
    records: {
      exists: async () => true,
      read: async () => current,
      write: async (next) => {
        current = next;
      },
    },
    journal: {
      stage: ports.journal.stage,
      load: async () => opening(),
      markPublished: async () => {
        assert.equal(inbox.length, 2);
        published = true;
      },
    },
    chain: {
      readAccount: async () => ({
        booted: true,
        specVersion: 3,
        authNonce: nonce,
        deviceEpoch: 0n,
        entryCount: 1,
        encKey: new Uint8Array(32).fill(8),
        inboxEntries: inbox,
        hasEntry: (entry) =>
          hex(entry) ===
          hex(
            pureCircuits.derive_device_entry_with_jubjub(
              { bytes: Buffer.from(account, 'hex') },
              owner,
              0n,
              current.localUseCounter,
            ),
          ),
      }),
      call: async (request) => {
        if (request.circuit === 'issue_grant_with_jubjub') {
          const tx = await issueCall(request);
          setActiveIds([opening().bookkeeping.grantId]);
          nonce++;
          return tx;
        }
        assert.equal(request.circuit, 'append_inbox_with_jubjub');
        assert.ok(request.args[0] instanceof Uint8Array);
        inbox.push(request.args[0]);
        nonce++;
        return { txHash: `append-${inbox.length}` };
      },
    },
    authoriser: {
      ...ports.authoriser,
      withKeySession: async (operation) => operation(),
      authorise: (request) =>
        request.circuit === 'issue_grant_with_jubjub'
          ? issueSign(request)
          : Promise.resolve({
              scheme: 'jubjub-schnorr',
              pk: owner,
              useCounter: request.useCounter,
              sigR: owner,
              sigS: 8n,
              grindNonce: 3n,
            }),
    },
    viewingKey: {
      readerPublicKey: async () => new Uint8Array(32),
      createKeys: async () => ({ encKey: new Uint8Array(32), envelopes: [], registrations: [] }),
      sealToDevice: async () => ({ envelope: new Uint8Array(), registration: new Uint8Array() }),
      sealGrant: async () => sealed,
      openInbox: async (_networkId, _keyring, entries) =>
        entries.map((entry) => {
          if (entry === sealed[0])
            return {
              kind: 'grant',
              record: {
                part: 'grant',
                grantId: opening().bookkeeping.grantId,
                slot: opening().bookkeeping.slot,
                scopeSalt: opening().bookkeeping.scopeSalt,
                granteePublicKey: opening().bookkeeping.granteePublicKey,
              },
            };
          if (entry === sealed[1])
            return {
              kind: 'grant',
              record: {
                part: 'object',
                grantId: opening().bookkeeping.grantId,
                object: opening().bookkeeping.object,
              },
            };
          return null;
        }),
    },
  };
  const result = await issueAndPublishJubjubGrant(input, settled);
  assert.equal(result.status, 'active');
  assert.equal(result.txHash, 'tx');
  assert.deepEqual(result.appendTxHashes, ['append-1', 'append-2']);
  assert.equal(result.nextUseCounter, 3n);
  assert.equal(published, true);
});
