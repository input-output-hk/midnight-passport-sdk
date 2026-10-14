import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jubjub } from '@noble/curves/misc.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { prepareJubjubGrant } from '../packages/account/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

/** @param {Uint8Array} bytes */
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const grantee = hex(
  jubjub.Point.fromAffine(pureCircuits.compute_public_point_with_jubjub(7n)).toBytes(),
);
const account = '12'.repeat(32);
/** @type {import('../packages/account/dist/grant-scope.js').GrantScopeInput} */
const baseScope = {
  grantee: { scheme: 'jubjub-schnorr', publicKey: grantee },
  operations: ['withdraw-unshielded'],
  color: '34'.repeat(32),
  recipient: { kind: 'any' },
  maxCoinValue: '100',
  perCallCap: '10',
  cap: '100',
  expiresAt: 2000,
};
const salt = new Uint8Array(32).fill(9);
const random = () => salt.slice();
/**
 * @param {import('../packages/account/dist/grant-scope.js').GrantScopeInput} [scope]
 * @param {string[]} [activeGrantIds]
 * @returns {import('../packages/account/dist/grant-scope.js').PrepareJubjubGrantInput}
 */
const input = (scope = baseScope, activeGrantIds = []) => ({
  account,
  origin: 'example.org',
  scope,
  activeGrantIds,
  nowSeconds: 1000,
});

test('grant preparation matches the generated JubJub pure circuits and chooses the first free slot', () => {
  const first = prepareJubjubGrant(input(), pureCircuits, random);
  assert.equal(first.slot, 0);
  assert.equal(first.grantId.length, 64);
  assert.deepEqual(
    first.scopeDigest,
    pureCircuits.derive_grant_scope_digest(first.scopeSalt, ...first.scopeArgs),
  );
  assert.deepEqual(
    first.objectCommit,
    pureCircuits.derive_grant_object_commit(
      first.scopeSalt,
      first.scopeArgs[4],
      first.scopeArgs[5],
      first.scopeArgs[6],
      first.scopeArgs[7],
    ),
  );
  const second = prepareJubjubGrant(input(baseScope, [first.grantId]), pureCircuits, random);
  assert.equal(second.slot, 1);
  assert.notEqual(second.grantId, first.grantId);
  assert.notEqual(
    prepareJubjubGrant({ ...input(), origin: 'other.example' }, pureCircuits, random).grantId,
    first.grantId,
  );
});

test('read grant binds the X25519 key and rejects unsafe or incomplete scopes', () => {
  const readPublicKey = hex(x25519.getPublicKey(new Uint8Array(32).fill(3)));
  const scope = { ...baseScope, read: true, rpId: 'example.org', readPublicKey };
  const prepared = prepareJubjubGrant(input(scope), pureCircuits, random);
  assert.equal(prepared.scopeArgs[3], true);
  assert.notEqual(hex(prepared.scopeArgs[12]), '00'.repeat(32));
  /** @type {import('../packages/account/dist/grant-scope.js').GrantScopeInput[]} */
  const invalidScopes = [
    { ...baseScope, operations: ['withdraw-shielded'] },
    { ...baseScope, read: true },
    { ...scope, readPublicKey: '00'.repeat(32) },
    { ...baseScope, grantee: { scheme: 'jubjub-schnorr', publicKey: '00'.repeat(32) } },
    { ...baseScope, cap: '9' },
    { ...baseScope, expiresAt: 1000 },
    { ...baseScope, window: { lengthSeconds: 60, cap: '10' } },
  ];
  for (const invalid of invalidScopes) {
    assert.throws(() => prepareJubjubGrant(input(invalid), pureCircuits, random), {
      code: 'GrantScopeInvalid',
    });
  }
});

test('active grant limit and unsafe salt fail before issuing a grant', () => {
  const active = Array.from({ length: 16 }, (_, i) => i.toString(16).padStart(64, '0'));
  assert.throws(() => prepareJubjubGrant(input(baseScope, active), pureCircuits, random), {
    code: 'GrantLimitReached',
  });
  assert.throws(() => prepareJubjubGrant(input(), pureCircuits, () => new Uint8Array(32)), {
    code: 'GrantScopeInvalid',
  });
});
