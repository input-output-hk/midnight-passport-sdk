import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jubjub } from '@noble/curves/misc.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { prepareJubjubGrant, verifyStagedGrantCommitment } from '../packages/account/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

/** @param {Uint8Array} value */
const hex = (value) => Buffer.from(value).toString('hex');
const account = 'ab'.repeat(32);
const baseScope = {
  grantee: {
    scheme: /** @type {const} */ ('jubjub-schnorr'),
    publicKey: hex(jubjub.Point.BASE.toBytes()),
  },
  operations: /** @type {const} */ (['withdraw-unshielded']),
  color: '34'.repeat(32),
  recipient: /** @type {const} */ ({ kind: 'any' }),
  maxCoinValue: '100',
  perCallCap: '10',
  cap: '100',
  expiresAt: 2000,
};

/** @param {boolean} read */
function fixture(read) {
  const readPublicKey = hex(x25519.getPublicKey(new Uint8Array(32).fill(7)));
  const scope = {
    ...baseScope,
    ...(read && { read: true, rpId: 'example.org', readPublicKey }),
  };
  const prepared = prepareJubjubGrant(
    { account, origin: 'example.org', scope, activeGrantIds: [], nowSeconds: 1000 },
    pureCircuits,
    (length) => new Uint8Array(length).fill(9),
  );
  const staged = {
    account,
    origin: 'example.org',
    scope,
    scopeDigest: hex(prepared.scopeDigest),
    bookkeeping: {
      grantId: prepared.grantId,
      slot: prepared.slot,
      scopeSalt: hex(prepared.scopeSalt),
      granteePublicKey: scope.grantee.publicKey,
      ...(read && { readPublicKey }),
      object: { color: scope.color, recipient: scope.recipient, maxCoinValue: scope.maxCoinValue },
    },
  };
  const live = {
    active: true,
    read,
    authNonce: 7n,
    objectCommit: prepared.objectCommit,
    readPkHash: read ? sha256(Buffer.from(readPublicKey, 'hex')) : new Uint8Array(32),
  };
  return { staged, live };
}

for (const read of [false, true])
  test(`staged ${read ? 'read' : 'spend'} opening matches only its live commitments`, () => {
    const { staged, live } = fixture(read);
    assert.doesNotThrow(() => verifyStagedGrantCommitment(staged, live, pureCircuits));
    assert.throws(
      () =>
        verifyStagedGrantCommitment(
          staged,
          { ...live, objectCommit: new Uint8Array(32) },
          pureCircuits,
        ),
      { code: 'GrantScopeInvalid' },
    );
    assert.throws(
      () =>
        verifyStagedGrantCommitment(
          staged,
          { ...live, readPkHash: new Uint8Array(32).fill(3) },
          pureCircuits,
        ),
      { code: 'GrantScopeInvalid' },
    );
    assert.throws(
      () => verifyStagedGrantCommitment({ ...staged, origin: 'other.example' }, live, pureCircuits),
      { code: 'GrantScopeInvalid' },
    );
  });
