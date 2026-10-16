import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jubjub } from '@noble/curves/misc.js';
import { checkUnshieldedGrant, grantOriginHash } from '../packages/account/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

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
