import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { jubjub } from '@noble/curves/misc.js';
import { grantOriginHash } from '../packages/account/dist/index.js';
import { pureCircuits as pure } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { recipeJubjubAuthoriser } from '../packages/keys/dist/index.js';

const root = resolve(import.meta.dirname, '..');
const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString('hex');
const bytes = (/** @type {string} */ value) => Buffer.from(value, 'hex');
const account = '11'.repeat(32);
const application = '22'.repeat(32);
const color = '33'.repeat(32);
const recipient = '44'.repeat(32);
const scopeSalt = '55'.repeat(32);
const pk = pure.compute_public_point_with_jubjub(7n);
const grantId = hex(
  pure.derive_grant_id_with_jubjub({ bytes: bytes(account) }, pk, grantOriginHash('localhost'), 0n),
);
const intent = {
  account,
  grantId,
  granteePublicKey: hex(jubjub.Point.fromAffine(pk).toBytes()),
  origin: 'localhost',
  slot: 0,
  scopeSalt,
  color,
  amount: '4',
  recipient,
  maxCoinValue: '10',
  spentPrev: '0',
};

async function fixture(/** @type {import('node:test').TestContext} */ t) {
  const temp = mkdtempSync(join(tmpdir(), 'passport-merchant-test-'));
  t.after(() => rmSync(temp, { force: true, recursive: true }));
  const scope = join(temp, 'node_modules/@input-output-hk');
  mkdirSync(scope, { recursive: true });
  symlinkSync(join(root, 'packages/account'), join(scope, 'mn-passport-account'));
  cpSync(join(root, 'examples/application-acc/prepare-payment.mjs'), join(temp, 'prepare.mjs'));
  const { prepareMerchantPayment } = await import(pathToFileURL(join(temp, 'prepare.mjs')).href);
  let reads = 0;
  let sessions = 0;
  let signs = 0;
  let reviews = 0;
  const secret = new Uint8Array(32);
  secret[0] = 7;
  const signer = recipeJubjubAuthoriser(
    {
      withSession: async (work) => work(),
      deviceSecret: async () => secret.slice(),
      deriveSecret: async () => secret.slice(),
    },
    pure,
  );
  const snapshot = {
    merchant: { address: application, account, color, recipient, price: '4' },
    grant: {
      active: true,
      issuedAt: 100n,
      nonce: 0n,
      spentCommit: pure.derive_grant_spent_commit(bytes(scopeSalt), 0n),
      objectCommit: pure.derive_grant_object_commit(
        bytes(scopeSalt),
        bytes(color),
        1n,
        bytes(recipient),
        10n,
      ),
      withdrawUnshielded: true,
      perCallCap: 5n,
      cap: 10n,
      expiresAt: 2000n,
      callerCommit: pure.derive_grant_caller_commit(bytes(scopeSalt), {
        is_some: true,
        value: { bytes: bytes(application) },
      }),
    },
  };
  const ports = {
    pure,
    grantee: {
      ...signer,
      /** @template T @param {() => Promise<T>} work */
      async withKeySession(work) {
        sessions++;
        return signer.withKeySession(work);
      },
      async authorise(
        /** @type {import('../packages/account/dist/ports/index.js').AuthorisationRequest} */ request,
      ) {
        signs++;
        return signer.authorise(request);
      },
    },
    async read() {
      reads++;
      return structuredClone(snapshot);
    },
    async review(/** @type {{application: string, amount: string, recipient: string}} */ payment) {
      reviews++;
      assert.equal(payment.application, application);
      assert.equal(payment.amount, '4');
      assert.equal(payment.recipient, recipient);
      return true;
    },
    nowSeconds: () => 1000,
  };
  return {
    run: (options = {}) => prepareMerchantPayment(intent, { ...ports, ...options }),
    ports,
    snapshot,
    counts: () => ({ reads, sessions, signs, reviews }),
  };
}

test('merchant recipe prepares a real ACC signature for reviewed fixed payment; no submission', async (t) => {
  const f = await fixture(t);
  const prepared = await f.run();
  assert.equal(hex(prepared.account.bytes), account);
  assert.equal(prepared.approval.max_coin_value, 10n);
  assert.equal(prepared.approval.spent_prev, 0n);
  assert.equal(prepared.approval.pk.x, pk.x);
  const challenge = pure.challenge_withdraw_unshielded_with_grant_jubjub(
    prepared.account,
    prepared.approval.sig_r,
    pk,
    bytes(grantId),
    100n,
    bytes(color),
    4n,
    { bytes: bytes(recipient) },
    0n,
    prepared.approval.grind_nonce,
  );
  const scalar = BigInt('0x' + Buffer.from(challenge).reverse().toString('hex'));
  const r = jubjub.Point.fromAffine(prepared.approval.sig_r);
  const point = jubjub.Point.fromAffine(pk);
  const generator = jubjub.Point.fromAffine(pure.compute_public_point_with_jubjub(1n));
  assert.ok(generator.multiply(prepared.approval.sig_s).equals(r.add(point.multiply(scalar))));
  assert.deepEqual(f.counts(), { reads: 2, sessions: 1, signs: 1, reviews: 1 });
});

for (const field of /** @type {const} */ (['account', 'color', 'recipient', 'price'])) {
  test(`changed merchant ${field} is refused before review or key session`, async (t) => {
    const f = await fixture(t);
    f.snapshot.merchant[field] = field === 'price' ? '5' : '66'.repeat(32);
    await assert.rejects(f.run(), /payment differs/);
    assert.deepEqual(f.counts(), { reads: 1, sessions: 0, signs: 0, reviews: 0 });
  });
}

for (const kind of ['unrestricted', 'wrong contract']) {
  test(`${kind} grant refuses before review or key session`, async (t) => {
    const f = await fixture(t);
    f.snapshot.grant.callerCommit =
      kind === 'unrestricted'
        ? new Uint8Array(32)
        : pure.derive_grant_caller_commit(bytes(scopeSalt), {
            is_some: true,
            value: { bytes: bytes('77'.repeat(32)) },
          });
    await assert.rejects(f.run(), /not pinned to this merchant/);
    assert.deepEqual(f.counts(), { reads: 1, sessions: 0, signs: 0, reviews: 0 });
  });
}

for (const kind of ['revoked', 'expired', 'stale opening']) {
  test(`${kind} grant never signs a merchant payment`, async (t) => {
    const f = await fixture(t);
    if (kind === 'revoked') f.snapshot.grant.active = false;
    if (kind === 'expired') f.snapshot.grant.expiresAt = 1000n;
    if (kind === 'stale opening') f.snapshot.grant.spentCommit = new Uint8Array(32);
    await assert.rejects(f.run());
    assert.equal(f.counts().signs, 0);
    assert.equal(f.counts().sessions, 0);
  });
}

test('declined consent and preflight cancellation never open a key session', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.run({ review: async () => false }), /declined/);
  await assert.rejects(f.run({ signal: { aborted: true } }), /cancelled/);
  assert.equal(f.counts().sessions, 0);
  assert.equal(f.counts().signs, 0);
});

test('context mutation during review is refused before any signature', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    f.run({
      read: async () => f.snapshot,
      review: async () => {
        f.snapshot.grant.nonce++;
        return true;
      },
    }),
    /changed after review/,
  );
  assert.equal(f.counts().signs, 0);
});
