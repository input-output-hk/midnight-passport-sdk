import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jubjub } from '@noble/curves/misc.js';
import { grantOriginHash } from '@input-output-hk/mn-passport-account';
import { pureCircuits } from '@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1';
import { grantHandoffFromOpening, parseGrantHandoff } from '../src/grant-handoff.ts';

const pure = pureCircuits;
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const account = 'ab'.repeat(32);
const granteePublicKey = hex(jubjub.Point.BASE.toBytes());
const slot = 0;
const scopeSalt = 'cd'.repeat(32);
const color = '00'.repeat(32);
const recipient = 'ef'.repeat(32);
const grantId = hex(
  pure.derive_grant_id_with_jubjub(
    { bytes: Buffer.from(account, 'hex') },
    jubjub.Point.BASE.toAffine(),
    grantOriginHash('localhost'),
    0n,
  ),
);
const objectCommit = pure.derive_grant_object_commit(
  Buffer.from(scopeSalt, 'hex'),
  Buffer.from(color, 'hex'),
  1n,
  Buffer.from(recipient, 'hex'),
  10n,
);
const staged = {
  account,
  origin: 'localhost',
  scopeDigest: 'aa'.repeat(32),
  scope: {
    grantee: { scheme: 'jubjub-schnorr' as const, publicKey: granteePublicKey },
    operations: ['withdraw-unshielded' as const],
    color,
    recipient: { kind: 'user-address' as const, value: recipient },
    maxCoinValue: '10',
    perCallCap: '4',
    cap: '10',
    expiresAt: null,
  },
  bookkeeping: {
    grantId,
    slot,
    scopeSalt,
    granteePublicKey,
    object: {
      color,
      recipient: { kind: 'user-address' as const, value: recipient },
      maxCoinValue: '10',
    },
  },
};
const live = {
  active: true,
  read: false,
  authNonce: 1n,
  objectCommit,
  readPkHash: new Uint8Array(32),
};
const context = {
  active: true,
  issuedAt: 1n,
  nonce: 0n,
  spentCommit: pure.derive_grant_spent_commit(Buffer.from(scopeSalt, 'hex'), 0n),
  objectCommit,
  withdrawUnshielded: true,
  perCallCap: 4n,
  cap: 10n,
  expiresAt: 0n,
};

test('owner exports only a live fixed-recipient opening, and holder parses it on the pinned network', () => {
  const handoff = grantHandoffFromOpening(staged, live, context, 'undeployed', pure);
  assert.equal(handoff.grantId, grantId);
  assert.equal(handoff.scopeSalt, scopeSalt);
  assert.deepEqual(parseGrantHandoff(JSON.stringify(handoff), 'undeployed'), handoff);
  assert.throws(() => parseGrantHandoff(JSON.stringify(handoff), 'mainnet'));
  assert.throws(() =>
    parseGrantHandoff(JSON.stringify({ ...handoff, privateKey: 'x' }), 'undeployed'),
  );
});

test('revoked or changed grants cannot be exported as a current opening', () => {
  assert.throws(() =>
    grantHandoffFromOpening(staged, { ...live, active: false }, context, 'undeployed', pure),
  );
  assert.throws(() =>
    grantHandoffFromOpening(staged, live, { ...context, cap: 11n }, 'undeployed', pure),
  );
  assert.throws(() =>
    grantHandoffFromOpening(
      { ...staged, bookkeeping: { ...staged.bookkeeping, scopeSalt: 'ff'.repeat(32) } },
      live,
      context,
      'undeployed',
      pure,
    ),
  );
});
