import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { p256 } from '@noble/curves/nist.js';
import { prepareP256UnshieldedGrant } from '../packages/account/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString('hex');
const policyRpHash = createHash('sha256').update('localhost').digest('hex');
const point = pureCircuits.compute_public_point_with_p256(7n);
const input = {
  scope: {
    account: '0c'.repeat(32),
    grantee: {
      scheme: /** @type {const} */ ('p256-webauthn'),
      publicKey: hex(p256.Point.fromAffine(point).toBytes(true)),
      origin: 'http://localhost:5173',
      rpIdHash: policyRpHash,
    },
    color: '22'.repeat(32),
    recipient: '38'.repeat(32),
    maxCoinValue: '10',
    perCallCap: '5',
    cap: '9',
    expiresAt: 2000,
  },
  activeGrantIds: /** @type {string[]} */ ([]),
  nowSeconds: 1000,
};
const salt = () => Buffer.alloc(32, 27);

test('P-256 grant preparation agrees with the pinned identity and RP vectors', () => {
  const result = prepareP256UnshieldedGrant(input, pureCircuits, salt);
  assert.deepEqual(result.opening, {
    scope: input.scope,
    grantId: '9c54d1703e5212d0d3b12fff92be0e1bf06d6657c5cc667437fe4374b13ca61d',
    slot: 0,
    scopeSalt: '1b'.repeat(32),
  });
  assert.equal(
    hex(result.rpCommit),
    '06baf16a610a09679bcb516bfbc06fa5308ce89426c1f7ba01377aa5dc575b6a',
  );
  assert.deepEqual(result.scopeArgs.slice(0, 4), [true, false, false, false]);
  assert.equal(result.scopeArgs[5], 1n);
  assert.equal(hex(result.scopeArgs[6]), input.scope.recipient);
  assert.equal(hex(result.scopeArgs[11]), policyRpHash);
  assert.equal(result.scopeArgs[15].is_some, false);
  assert.deepEqual(
    result.scopeDigest,
    pureCircuits.derive_grant_scope_digest(salt(), ...result.scopeArgs),
  );
  assert.deepEqual(
    result.objectCommit,
    pureCircuits.derive_grant_object_commit(
      salt(),
      result.scopeArgs[4],
      1n,
      result.scopeArgs[6],
      10n,
    ),
  );
});

test('origin, RP and active-slot changes affect the corresponding commitments independently', () => {
  const first = prepareP256UnshieldedGrant(input, pureCircuits, salt);
  const occupied = prepareP256UnshieldedGrant(
    { ...input, activeGrantIds: [first.opening.grantId] },
    pureCircuits,
    salt,
  );
  assert.equal(occupied.opening.slot, 1);
  assert.notEqual(occupied.opening.grantId, first.opening.grantId);
  const otherOrigin = prepareP256UnshieldedGrant(
    {
      ...input,
      scope: {
        ...input.scope,
        grantee: { ...input.scope.grantee, origin: 'http://localhost:5174' },
      },
    },
    pureCircuits,
    salt,
  );
  assert.notEqual(otherOrigin.opening.grantId, first.opening.grantId);
  assert.deepEqual(otherOrigin.rpCommit, first.rpCommit);
  const otherRp = prepareP256UnshieldedGrant(
    {
      ...input,
      scope: { ...input.scope, grantee: { ...input.scope.grantee, rpIdHash: '12'.repeat(32) } },
    },
    pureCircuits,
    salt,
  );
  assert.equal(otherRp.opening.grantId, first.opening.grantId);
  assert.notDeepEqual(otherRp.rpCommit, first.rpCommit);
  assert.notDeepEqual(otherRp.scopeDigest, first.scopeDigest);
});

test('malformed, expired and over-cap scopes fail before allocating private salt', () => {
  const invalid = [
    { ...input.scope, recipient: '00'.repeat(32) },
    { ...input.scope, cap: '4' },
    { ...input.scope, cap: '0' },
    { ...input.scope, cap: '09' },
    { ...input.scope, maxCoinValue: '4' },
    { ...input.scope, expiresAt: 1000 },
    { ...input.scope, grantee: { ...input.scope.grantee, publicKey: '02' + 'ff'.repeat(32) } },
    { ...input.scope, grantee: { ...input.scope.grantee, origin: 'http://localhost:80/x' } },
    { ...input.scope, grantee: { ...input.scope.grantee, origin: 'https://me@wallet.ioo' } },
    { ...input.scope, caller: '11'.repeat(32) },
  ];
  for (const scope of invalid) {
    assert.throws(
      () =>
        prepareP256UnshieldedGrant({ ...input, scope }, pureCircuits, () =>
          assert.fail('salt allocated'),
        ),
      { code: 'GrantScopeInvalid' },
    );
  }
  const activeGrantIds = Array.from({ length: 16 }, (_, index) =>
    index.toString(16).padStart(64, '0'),
  );
  assert.throws(
    () =>
      prepareP256UnshieldedGrant({ ...input, activeGrantIds }, pureCircuits, () =>
        assert.fail('salt allocated'),
      ),
    { code: 'GrantLimitReached' },
  );
  assert.throws(() => prepareP256UnshieldedGrant(input, pureCircuits, () => new Uint8Array(32)), {
    code: 'GrantScopeInvalid',
  });
});

test('preparation owns the opening admitted before the random callback', () => {
  const candidate = structuredClone(input);
  const result = prepareP256UnshieldedGrant(candidate, pureCircuits, () => {
    candidate.scope.recipient = '40'.repeat(32);
    candidate.scope.grantee.rpIdHash = '41'.repeat(32);
    return salt();
  });
  assert.equal(result.opening.scope.recipient, input.scope.recipient);
  assert.equal(result.opening.scope.grantee.rpIdHash, policyRpHash);
});
