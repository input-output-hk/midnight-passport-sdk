import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isPublishableUnshieldedGrant,
  publishedGrantParts,
} from '../packages/account/dist/grant-publication-state.js';

const account = 'ab'.repeat(32);
const grantId = 'cd'.repeat(32);
/** @type {import('../packages/account/dist/ports/index.js').GrantBookkeeping} */
const bookkeeping = {
  grantId,
  slot: 3,
  scopeSalt: '09'.repeat(32),
  granteePublicKey: '10'.repeat(32),
  object: {
    color: '34'.repeat(32),
    recipient: { kind: 'contract-address', value: '56'.repeat(32) },
    maxCoinValue: '100',
  },
};
/** @type {import('../packages/account/dist/jubjub-grant-issue.js').StagedJubjubGrant} */
const staged = {
  account,
  origin: 'example.org',
  scopeDigest: '11'.repeat(32),
  scope: {
    grantee: { scheme: 'jubjub-schnorr', publicKey: bookkeeping.granteePublicKey },
    operations: ['withdraw-unshielded'],
    color: bookkeeping.object.color,
    recipient: bookkeeping.object.recipient,
    maxCoinValue: bookkeeping.object.maxCoinValue,
    perCallCap: '10',
    cap: '100',
    expiresAt: 2000,
  },
  bookkeeping,
};

test('publication state ignores an older grant header at the same ID', () => {
  /** @type {import('../packages/account/dist/ports/index.js').OpenedInboxEntry[]} */
  const opened = [
    {
      kind: 'grant',
      record: { part: 'grant', ...bookkeeping, scopeSalt: '08'.repeat(32) },
    },
    {
      kind: 'grant',
      record: { part: 'object', grantId, object: bookkeeping.object },
    },
  ];
  assert.deepEqual(publishedGrantParts(opened, bookkeeping), { header: false, object: true });
  assert.deepEqual(
    publishedGrantParts(
      [...opened, { kind: 'grant', record: { part: 'grant', ...bookkeeping } }],
      bookkeeping,
    ),
    { header: true, object: true },
  );
});

test('publication refuses a corrupted or read-capable staged opening', () => {
  assert.equal(isPublishableUnshieldedGrant(staged, account, grantId), true);
  assert.equal(isPublishableUnshieldedGrant(staged, account, 'ef'.repeat(32)), false);
  assert.equal(
    isPublishableUnshieldedGrant(
      { ...staged, bookkeeping: { ...bookkeeping, scopeSalt: '00' } },
      account,
      grantId,
    ),
    false,
  );
  assert.equal(
    isPublishableUnshieldedGrant(
      { ...staged, scope: { ...staged.scope, read: true } },
      account,
      grantId,
    ),
    false,
  );
  assert.equal(
    isPublishableUnshieldedGrant(
      {
        ...staged,
        bookkeeping: {
          ...bookkeeping,
          object: { ...bookkeeping.object, maxCoinValue: '101' },
        },
      },
      account,
      grantId,
    ),
    false,
  );
});
