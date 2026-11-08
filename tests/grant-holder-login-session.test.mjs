// Independent holder: real WebAuthn/PRF/JubJub signing, synthetic grant chain only.
import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  checkUnshieldedGrant,
  grantOriginHash,
  spendUnshieldedWithGrant,
} from '../packages/account/dist/index.js';
import { webauthnPasskey } from '../packages/adapter-webauthn/dist/index.js';
import {
  PRF_LABEL_AUTHORISER,
  prfSalt,
  recipeJubjubAuthoriser,
} from '../packages/keys/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { softwareAuthenticator, RP, ORIGIN } from './fixtures/software-authenticator.mjs';

const account = '12'.repeat(32);
const color = '34'.repeat(32);
const recipient = '56'.repeat(32);
const salt = '78'.repeat(32);
/** @param {Uint8Array} value */
const hex = (value) => Buffer.from(value).toString('hex');

async function fixture() {
  const auth = softwareAuthenticator();
  const expected = recipeJubjubAuthoriser(
    {
      withSession: (work) => work(),
      deviceSecret: async () => sha256(prfSalt(PRF_LABEL_AUTHORISER)),
      deriveSecret: async () => {
        throw Error('Expected owner fixture cannot derive reader data');
      },
    },
    pureCircuits,
  );
  const point = await expected.devicePublicKey();
  const granteePublicKey = await expected.devicePublicKeyHex();
  const grantId = hex(
    pureCircuits.derive_grant_id_with_jubjub(
      { bytes: Buffer.from(account, 'hex') },
      point,
      grantOriginHash(RP),
      0n,
    ),
  );
  const intent = {
    account,
    grantId,
    granteePublicKey,
    origin: RP,
    slot: 0,
    scopeSalt: salt,
    color,
    amount: '4',
    recipient,
    maxCoinValue: '10',
    spentPrev: '3',
  };
  let state = {
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
  let sends = 0;
  const ports = {
    pure: pureCircuits,
    source: { readGrantSpendContext: async () => state },
    chain: {
      readAccount: async () => {
        throw Error('Independent holder must not open owner account');
      },
      async call(
        /** @type {import('../packages/account/dist/ports/index.js').CallRequest} */ request,
      ) {
        sends++;
        assert.equal(request.circuit, 'withdraw_unshielded_with_grant_jubjub');
        state = {
          ...state,
          nonce: 3n,
          spentCommit: pureCircuits.derive_grant_spent_commit(Buffer.from(salt, 'hex'), 7n),
        };
        return { txHash: 'ab'.repeat(32) };
      },
    },
    nowSeconds: () => 1000,
    sleep: async () => {},
    attempts: 1,
  };
  return { auth, intent, ports, state: () => state, sends: () => sends };
}

for (const route of /** @type {const} */ (['approved', 'declined', 'wrong holder'])) {
  test(`independent holder ${route} uses one compound request and retains the exact transfer review`, async () => {
    const f = await fixture();
    const container = {
      ...f.auth.container,
      async get(/** @type {Parameters<typeof f.auth.container.get>[0]} */ request) {
        const credential = await f.auth.container.get(request);
        assert.ok(credential);
        if (route !== 'wrong holder') return credential;
        const outputs = credential.getClientExtensionResults().prf?.results;
        assert.ok(outputs);
        return {
          ...credential,
          getClientExtensionResults: () => ({
            prf: { results: { ...outputs, first: new Uint8Array(32).fill(8).buffer } },
          }),
        };
      },
    };
    /** @type {string[]} */
    const purposes = [];
    const adapter = webauthnPasskey({
      rpId: RP,
      origin: ORIGIN,
      credentials: container,
      beforeCeremony: ({ purpose }) => {
        purposes.push(purpose);
      },
    });
    const login = adapter.credentials.withLoginSession?.bind(adapter.credentials);
    assert.ok(login);
    let reviews = 0;
    const spend = () => {
      checkUnshieldedGrant(f.intent, f.state(), pureCircuits, 1000);
      return login(async () => {
        await adapter.credentials.identify();
        const grantee = recipeJubjubAuthoriser(adapter.prf, pureCircuits);
        return spendUnshieldedWithGrant(f.intent, {
          ...f.ports,
          grantee,
          async review(fields) {
            reviews++;
            assert.deepEqual(fields, {
              account,
              grantId: f.intent.grantId,
              color,
              amount: '4',
              recipient,
              remainingCap: '6',
            });
            return route !== 'declined';
          },
        });
      });
    };
    if (route === 'approved') {
      const result = await spend();
      assert.equal(result.spentTotal, 7n);
      assert.equal(f.sends(), 1);
      assert.equal(reviews, 1);
    } else {
      await assert.rejects(spend(), {
        code: route === 'declined' ? 'UserCancelled' : 'NotAuthorised',
      });
      assert.equal(f.sends(), 0);
      assert.equal(reviews, route === 'declined' ? 1 : 0);
    }
    assert.equal(f.auth.gets.length, 1);
    assert.deepEqual(purposes, ['identify-and-unlock']);
    assert.throws(() => adapter.readLoginKeys(f.auth.gets[0]?.allowCredentials?.[0]?.id), {
      code: 'NotAuthorised',
    });
  });
}
