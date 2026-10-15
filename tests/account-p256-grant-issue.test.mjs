import assert from 'node:assert/strict';
import { test } from 'node:test';
import { p256 } from '@noble/curves/nist.js';
import { jubjub } from '@noble/curves/misc.js';
import { issueP256GrantCall } from '../packages/account/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

/** @param {Uint8Array} bytes */
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const account = 'ab'.repeat(32);
const owner = { ...p256.Point.BASE.toAffine(), identity: false };
const policy = { rp_id_hash: new Uint8Array(32).fill(4), origin: new Uint8Array(21).fill(5) };
const credentialId = Uint8Array.of(7);
const grantee = hex(jubjub.Point.BASE.toBytes());
/** @type {import('../packages/account/dist/ports/index.js').AccountHint} */
const hint = {
  address: account,
  scheme: 'p256-webauthn',
  publicKey: owner,
  policy,
  credentialId,
  status: 'active',
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
  /** @type {import('../packages/account/dist/jubjub-grant-issue.js').StagedJubjubGrant[]} */
  const staged = [];
  let rosterNonce = 5n;
  /** @type {import('../packages/account/dist/ports/index.js').AccountRecord} */
  let record = {
    address: account,
    bindingId: 'acc-s3r1.1',
    scheme: 'p256-webauthn',
    credentialId,
    localUseCounter: 0n,
  };
  const deviceEntry = pureCircuits.derive_device_entry_with_p256(
    { bytes: Buffer.from(account, 'hex') },
    owner,
    policy,
    0n,
    0n,
  );
  /** @type {import('../packages/account/dist/p256-grant-issue.js').IssueP256GrantCallPorts} */
  const ports = {
    bindingId: 'acc-s3r1.1',
    pure: pureCircuits,
    random: (length) => new Uint8Array(length).fill(9),
    nowSeconds: () => 1000,
    records: {
      exists: async () => {
        calls.push('presence');
        return true;
      },
      read: async () => {
        calls.push('record-read');
        return record;
      },
      write: async (next) => {
        calls.push('record-write');
        record = next;
      },
    },
    grants: {
      readActiveGrantIds: async () => [],
      readActiveGrantSnapshot: async () => {
        calls.push('roster');
        return { authNonce: rosterNonce, ids: [] };
      },
    },
    journal: {
      stage: async (opening) => {
        calls.push('stage');
        staged.push(opening);
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
          encKey: new Uint8Array(32).fill(8),
          inboxEntries: [],
          deviceEntries: [deviceEntry],
          hasEntry: (entry) => hex(entry) === hex(deviceEntry),
        };
      },
      call: async (request) => {
        calls.push('call');
        assert.equal(request.circuit, 'issue_grant_with_p256');
        assert.equal(request.args.length, 19);
        assert.equal(
          hex(/** @type {Uint8Array} */ (request.args[0])),
          staged[0]?.bookkeeping.grantId,
        );
        assert.equal(/** @type {{use_counter: bigint}} */ (request.args[18]).use_counter, 0n);
        return { txHash: 'tx' };
      },
    },
    authoriser: {
      scheme: 'p256-webauthn',
      devicePublicKey: async () => owner,
      deviceBinding: async () => ({ policy, credentialId }),
      withKeySession: async (operation, descriptor) => {
        calls.push('session');
        assert.equal(descriptor?.kind, 'issue-grant');
        assert.equal(descriptor?.grantId?.length, 64);
        return operation();
      },
      authorise: async (request) => {
        calls.push('sign');
        assert.equal(request.circuit, 'issue_grant_with_p256');
        assert.equal(request.useCounter, 0n);
        const id = /** @type {Uint8Array} */ (request.args[0]);
        const salt = /** @type {Uint8Array} */ (request.args.at(-1));
        const scopeArgs =
          /** @type {import('../packages/account/dist/grant-scope.js').GrantScopeArgs} */ (
            /** @type {unknown} */ (request.args.slice(1, -1))
          );
        assert.deepEqual(
          request.challenge,
          pureCircuits.challenge_issue_grant_with_p256(
            { bytes: Buffer.from(account, 'hex') },
            owner,
            id,
            pureCircuits.derive_grant_scope_digest(salt, ...scopeArgs),
            5n,
          ),
        );
        return {
          scheme: 'p256-webauthn',
          pk: owner,
          useCounter: request.useCounter,
          authenticatorData: new Uint8Array(37),
          sig: { r: 1n, s: 2n },
        };
      },
    },
  };
  return {
    ports,
    calls,
    staged,
    record: () => record,
    stale: () => {
      rosterNonce = 4n;
    },
  };
}

test('P-256 issue stages before submission and binds the challenge to scope and nonce', async () => {
  const world = fixture();
  const result = await issueP256GrantCall(input, world.ports);
  assert.equal(result.status, 'submitted');
  assert.equal(result.grantId, world.staged[0]?.bookkeeping.grantId);
  assert.equal(world.record().localUseCounter, 1n);
  assert.deepEqual(world.calls, [
    'presence',
    'ledger',
    'roster',
    'session',
    'record-read',
    'sign',
    'roster',
    'stage',
    'call',
    'record-write',
  ]);
});

test('P-256 issue refuses a stale grant roster before key consent', async () => {
  const world = fixture();
  world.stale();
  await assert.rejects(issueP256GrantCall(input, world.ports), { code: 'GrantRosterUnsettled' });
  assert.deepEqual(world.calls, ['presence', 'ledger', 'roster']);
});

test('P-256 issue refuses a grant roster changed after signing', async () => {
  const world = fixture();
  const authorise = world.ports.authoriser.authorise;
  world.ports.authoriser.authorise = async (request) => {
    const signature = await authorise(request);
    world.stale();
    return signature;
  };
  await assert.rejects(issueP256GrantCall(input, world.ports), {
    code: 'GrantRosterUnsettled',
  });
  assert.ok(!world.calls.includes('stage'));
  assert.ok(!world.calls.includes('call'));
});

test('P-256 read issue requires a rotation hook before key consent', async () => {
  const world = fixture();
  await assert.rejects(
    issueP256GrantCall(
      {
        ...input,
        scope: { ...scope, read: true, rpId: 'example.org', readPublicKey: '77'.repeat(32) },
      },
      world.ports,
    ),
    { code: 'BindingUnsupported' },
  );
  assert.deepEqual(world.calls, []);
});
