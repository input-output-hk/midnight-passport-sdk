import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jubjub } from '@noble/curves/misc.js';
import {
  checkUnshieldedGrant,
  grantOriginHash,
  spendUnshieldedWithGrant,
} from '../packages/account/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { recipeJubjubAuthoriser } from '../packages/keys/dist/index.js';

const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString('hex');
const account = '12'.repeat(32);
const color = '34'.repeat(32);
const recipient = '56'.repeat(32);
const salt = '78'.repeat(32);
const origin = 'localhost';
const slot = 0;
const pk = pureCircuits.compute_public_point_with_jubjub(7n);
const granteePublicKey = hex(jubjub.Point.fromAffine(pk).toBytes());
const grantId = hex(
  pureCircuits.derive_grant_id_with_jubjub(
    { bytes: Buffer.from(account, 'hex') },
    pk,
    grantOriginHash(origin),
    BigInt(slot),
  ),
);
const intent = {
  account,
  grantId,
  granteePublicKey,
  origin,
  slot,
  scopeSalt: salt,
  color,
  amount: '4',
  recipient,
  maxCoinValue: '10',
  spentPrev: '3',
};
const live = {
  active: true,
  issuedAt: 100n,
  nonce: 2n,
  spentCommit: pureCircuits.derive_grant_spent_commit(Buffer.from(salt, 'hex'), 3n),
  objectCommit: pureCircuits.derive_grant_object_commit(
    Buffer.from(salt, 'hex'),
    Buffer.from(color, 'hex'),
    1n,
    Buffer.from(recipient, 'hex'),
    10n,
  ),
  withdrawUnshielded: true,
  perCallCap: 5n,
  cap: 9n,
  expiresAt: 2000n,
};

test('fixed unshielded grant validates its live identity, object and spend commitments', () => {
  const checked = checkUnshieldedGrant(intent, live, pureCircuits, 1000);
  assert.equal(hex(checked.grantId), grantId);
  assert.equal(checked.amount, 4n);
  assert.equal(checked.spentPrev, 3n);
  assert.equal(checked.nonce, 2n);
});

test('revoked, expired, overspent, foreign-origin and stale openings fail before signing', () => {
  /** @type {Array<[import('../packages/account/dist/grant-holder.js').UnshieldedGrantIntent, import('../packages/account/dist/grant-holder.js').UnshieldedGrantContext | undefined, string]>} */
  const refused = [
    [intent, undefined, 'GrantNotFound'],
    [intent, { ...live, active: false }, 'GrantRevoked'],
    [intent, { ...live, expiresAt: 1000n }, 'GrantScopeInvalid'],
    [{ ...intent, amount: '6' }, live, 'GrantScopeInvalid'],
    [{ ...intent, amount: '7' }, { ...live, perCallCap: 10n }, 'GrantScopeInvalid'],
    [{ ...intent, origin: 'evil.example' }, live, 'GrantScopeInvalid'],
    [{ ...intent, recipient: '90'.repeat(32) }, live, 'GrantScopeInvalid'],
    [{ ...intent, color: '91'.repeat(32) }, live, 'GrantScopeInvalid'],
    [{ ...intent, spentPrev: '0' }, live, 'GrantScopeInvalid'],
    [intent, { ...live, withdrawUnshielded: false }, 'GrantScopeInvalid'],
  ];
  for (const [candidate, context, code] of refused)
    assert.throws(() => checkUnshieldedGrant(candidate, context, pureCircuits, 1000), { code });
});

test('a separate JubJub grantee signs the exact call and settles its live spent commitment', async () => {
  const secret = new Uint8Array(32);
  secret[0] = 7;
  const grantee = recipeJubjubAuthoriser(
    {
      withSession: (work) => work(),
      deviceSecret: async () => secret.slice(),
      deriveSecret: async () => secret.slice(),
    },
    pureCircuits,
  );
  let state = { ...live };
  let calls = 0;
  const ports = {
    pure: pureCircuits,
    source: { readGrantSpendContext: async () => state },
    chain: {
      readAccount: async () => undefined,
      /** @param {import('../packages/account/dist/ports/index.js').CallRequest} request */
      async call(request) {
        calls++;
        assert.equal(request.address, account);
        assert.equal(request.circuit, 'withdraw_unshielded_with_grant_jubjub');
        assert.equal(request.args.length, 14);
        assert.equal(request.args[1], 4n);
        assert.equal(hex(/** @type {{bytes: Uint8Array}} */ (request.args[2]).bytes), recipient);
        assert.equal(request.args[10], 3n);
        state = {
          ...state,
          nonce: state.nonce + 1n,
          spentCommit: pureCircuits.derive_grant_spent_commit(Buffer.from(salt, 'hex'), 7n),
        };
        return { txHash: 'ab'.repeat(32) };
      },
    },
    grantee,
    review: async () => true,
    nowSeconds: () => 1000,
    sleep: async () => {},
    attempts: 2,
  };
  const result = await spendUnshieldedWithGrant(intent, ports);
  assert.equal(result.txHash, 'ab'.repeat(32));
  assert.equal(result.spentTotal, 7n);
  assert.equal(result.grantNonce, 3n);
  assert.equal(calls, 1);
  await assert.rejects(spendUnshieldedWithGrant(intent, ports), { code: 'GrantScopeInvalid' });
  assert.equal(calls, 1, 'a stale opening must never submit a second value-bearing call');
});

test('declined review and a grant changed after review submit no transaction', async () => {
  const secret = new Uint8Array(32);
  secret[0] = 7;
  const grantee = recipeJubjubAuthoriser(
    {
      withSession: (work) => work(),
      deviceSecret: async () => secret.slice(),
      deriveSecret: async () => secret.slice(),
    },
    pureCircuits,
  );
  let state = { ...live };
  let calls = 0;
  const base = {
    pure: pureCircuits,
    source: { readGrantSpendContext: async () => state },
    chain: {
      readAccount: async () => undefined,
      async call() {
        calls++;
        return { txHash: 'ab'.repeat(32) };
      },
    },
    grantee,
    nowSeconds: () => 1000,
  };
  await assert.rejects(spendUnshieldedWithGrant(intent, { ...base, review: async () => false }), {
    code: 'UserCancelled',
  });
  await assert.rejects(
    spendUnshieldedWithGrant(intent, {
      ...base,
      review: async () => {
        state = { ...state, nonce: state.nonce + 1n };
        return true;
      },
    }),
    { code: 'GrantRosterUnsettled' },
  );
  assert.equal(calls, 0);
  state = { ...live };
  await assert.rejects(
    spendUnshieldedWithGrant(intent, {
      ...base,
      review: async () => true,
      attempts: 1,
    }),
    /** @param {unknown} error */ (error) => {
      const uncertain = /** @type {{code: string; txHash: string; retryable: boolean}} */ (error);
      assert.equal(uncertain.code, 'GrantRosterUnsettled');
      assert.equal(uncertain.txHash, 'ab'.repeat(32));
      assert.equal(uncertain.retryable, false);
      return true;
    },
  );
  assert.equal(calls, 1, 'one submitted call with uncertain settlement needs reconciliation');
});
