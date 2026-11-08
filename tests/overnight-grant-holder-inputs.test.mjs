import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jubjub } from '@noble/curves/misc.js';
import { grantOriginHash, spendUnshieldedWithGrant } from '../packages/account/dist/index.js';
import { recipeJubjubAuthoriser } from '../packages/keys/dist/index.js';
import { pureCircuits as pure } from '../packages/contract/generated/acc-s3r1.1/index.js';

function fixture() {
  const account = '12'.repeat(32),
    color = '34'.repeat(32),
    recipient = '56'.repeat(32),
    salt = '78'.repeat(32);
  const pk = pure.compute_public_point_with_jubjub(7n);
  const intent = {
    account,
    grantId: Buffer.from(
      pure.derive_grant_id_with_jubjub(
        { bytes: Buffer.from(account, 'hex') },
        pk,
        grantOriginHash('localhost'),
        0n,
      ),
    ).toString('hex'),
    granteePublicKey: Buffer.from(jubjub.Point.fromAffine(pk).toBytes()).toString('hex'),
    origin: 'localhost',
    slot: 0,
    scopeSalt: salt,
    color,
    amount: '4',
    recipient,
    maxCoinValue: '10',
    spentPrev: '3',
  };
  let live = {
    active: true,
    issuedAt: 100n,
    nonce: 2n,
    spentCommit: pure.derive_grant_spent_commit(Buffer.from(salt, 'hex'), 3n),
    objectCommit: pure.derive_grant_object_commit(
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
  const reads = /** @type {Array<{ account: string; grantId: string }>} */ ([]);
  const reviews = /** @type {Array<{ amount: string; color: string; recipient: string }>} */ ([]);
  const calls = /** @type {import('../packages/account/dist/ports/index.js').CallRequest[]} */ ([]);
  const secret = new Uint8Array(32);
  secret[0] = 7;
  const grantee = recipeJubjubAuthoriser(
    {
      withSession: (work) => work(),
      deviceSecret: async () => secret.slice(),
      deriveSecret: async () => secret.slice(),
    },
    pure,
  );
  const ports = {
    pure,
    source: {
      async readGrantSpendContext(/** @type {string} */ account, /** @type {string} */ grantId) {
        reads.push({ account, grantId });
        return live;
      },
    },
    grantee,
    async review(/** @type {{ amount: string; color: string; recipient: string }} */ fields) {
      reviews.push(fields);
      return true;
    },
    chain: {
      readAccount: async () => undefined,
      async call(
        /** @type {import('../packages/account/dist/ports/index.js').CallRequest} */ request,
      ) {
        calls.push(request);
        live = {
          ...live,
          nonce: 3n,
          spentCommit: pure.derive_grant_spent_commit(Buffer.from(salt, 'hex'), 7n),
        };
        return { txHash: 'ab'.repeat(32) };
      },
    },
    nowSeconds: () => 1000,
    attempts: 1,
  };
  return { intent, ports, reads, reviews, calls };
}

for (const stage of ['session', 'key', 'review', 'submit']) {
  test(`grant holder pins all caller fields across ${stage} suspension`, async () => {
    const f = fixture();
    const original = { ...f.intent };
    const mutate = () => {
      Object.assign(f.intent, {
        account: 'ff'.repeat(32),
        grantId: 'ee'.repeat(32),
        granteePublicKey: 'dd'.repeat(32),
        origin: 'other.example',
        slot: 255,
        scopeSalt: 'cc'.repeat(32),
        color: 'bb'.repeat(32),
        amount: '1',
        recipient: 'aa'.repeat(32),
        maxCoinValue: '1',
        spentPrev: '0',
      });
    };
    if (stage === 'session')
      f.ports.grantee.withKeySession = async (work) => {
        mutate();
        return work();
      };
    if (stage === 'key') {
      const getKey = f.ports.grantee.devicePublicKey;
      f.ports.grantee.devicePublicKey = async () => {
        mutate();
        return getKey();
      };
    }
    if (stage === 'review') {
      const review = f.ports.review;
      f.ports.review = async (fields) => {
        mutate();
        return review(fields);
      };
    }
    if (stage === 'submit') {
      const call = f.ports.chain.call;
      f.ports.chain.call = async (request) => {
        mutate();
        return call(request);
      };
    }
    const result = await spendUnshieldedWithGrant(f.intent, f.ports);
    assert.equal(f.reviews.length, 1);
    assert.deepEqual(f.reviews[0], {
      account: original.account,
      grantId: original.grantId,
      color: original.color,
      amount: original.amount,
      recipient: original.recipient,
      remainingCap: '6',
    });
    assert.ok(
      f.reads.every(
        (read) => read.account === original.account && read.grantId === original.grantId,
      ),
    );
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0]?.address, original.account);
    assert.equal(f.calls[0]?.args[1], 4n);
    assert.deepEqual(f.calls[0]?.args[0], Uint8Array.from(Buffer.from(original.color, 'hex')));
    assert.deepEqual(f.calls[0]?.args[2], {
      bytes: Uint8Array.from(Buffer.from(original.recipient, 'hex')),
    });
    assert.equal(result.grantId, original.grantId);
    assert.equal(result.spentTotal, 7n);
  });
}

test('malformed and oversized holder inputs refuse before opening a key session', async () => {
  for (const change of [
    { amount: '9'.repeat(100_000) },
    { amount: '1e3' },
    { amount: (1n << 128n).toString() },
    { amount: '1\n' },
    { spentPrev: '0'.repeat(100_000) },
    { origin: 'x'.repeat(1025) },
    { recipient: Buffer.alloc(32) },
    { scopeSalt: Buffer.alloc(32) },
  ]) {
    const f = fixture();
    let sessions = 0;
    f.ports.grantee.withKeySession = async (work) => {
      sessions++;
      return work();
    };
    await assert.rejects(
      spendUnshieldedWithGrant(
        /** @type {import('../packages/account/dist/grant-holder.js').UnshieldedGrantIntent} */ ({
          ...f.intent,
          ...change,
        }),
        f.ports,
      ),
      { code: 'GrantScopeInvalid' },
    );
    assert.equal(sessions, 0);
    assert.equal(f.reads.length, 0);
    assert.equal(f.reviews.length, 0);
    assert.equal(f.calls.length, 0);
  }
});
