import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPassportAccounts } from '../packages/account/dist/index.js';

const address = 'ab'.repeat(32);
const grantId = 'cd'.repeat(32);
const credentialId = Uint8Array.of(1, 2, 3);
const publicKey = { x: 11n, y: 13n, identity: false };
const policy = { rp_id_hash: new Uint8Array(32), origin: new Uint8Array(134) };

function world({ read = false, stale = false, changeAfterSign = false, revokeOne = false } = {}) {
  let nonce = 4n;
  let generation = 7n;
  let counter = 2n;
  let entries = [{ id: grantId, active: true, read }];
  let signed = 0;
  let calls = 0;
  /** @type {import('../packages/account/dist/ports/index.js').AccountHint} */
  const hint = {
    address,
    scheme: 'p256-webauthn',
    credentialId,
    publicKey,
    policy,
    status: 'active',
  };
  /** @type {import('../packages/account/dist/seams.js').AccPureCircuits} */
  const pureCircuits = {
    derive_boot_commitment_with_p256: () => new Uint8Array(32),
    derive_device_entry_with_p256: (_self, _pk, _policy, _epoch, useCounter) =>
      Uint8Array.of(Number(useCounter)),
    challenge_rotate_enc_key_with_p256: () => new Uint8Array(32),
    challenge_revoke_all_grants_with_p256: (_self, _pk, authNonce) =>
      Uint8Array.of(Number(authNonce)),
    challenge_revoke_grant_with_p256: (_self, _pk, _id, authNonce) =>
      Uint8Array.of(Number(authNonce)),
  };
  /** @type {import('../packages/account/dist/ports/index.js').PassportPorts} */
  const ports = {
    network: {
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      indexerUrl: '',
      indexerWsUrl: '',
      nodeUrl: '',
      artefactUrl: '',
      manifestSha256: '0'.repeat(64),
    },
    binding: { pureCircuits },
    credentials: {
      create: async () => ({ credentialId }),
      identify: async () => ({ credentialId, owns: () => true }),
    },
    authoriser: {
      scheme: 'p256-webauthn',
      devicePublicKey: async () => publicKey,
      deviceBinding: async () => ({ credentialId, policy }),
      authorise: async (request) => {
        signed++;
        assert.equal(
          request.circuit,
          revokeOne ? 'revoke_grant_with_p256' : 'revoke_all_grants_with_p256',
        );
        assert.deepEqual(request.challenge, Uint8Array.of(Number(nonce)));
        assert.deepEqual(request.credentialId, credentialId);
        if (changeAfterSign) entries = [{ id: 'ef'.repeat(32), active: true, read: false }];
        return {
          scheme: 'p256-webauthn',
          pk: publicKey,
          useCounter: counter,
          authenticatorData: new Uint8Array(37),
          sig: { r: 1n, s: 2n },
        };
      },
    },
    encryptionKey: { publicKey: async () => new Uint8Array(32) },
    chain: {
      readAccount: async () => ({
        booted: true,
        specVersion: 3,
        authNonce: nonce,
        deviceEpoch: 0n,
        entryCount: 1,
        hasEntry: (entry) => entry[0] === Number(counter),
      }),
      /** @param {import('../packages/account/dist/ports/index.js').CallRequest} request */
      call: async (request) => {
        const { circuit, args } = request;
        calls++;
        assert.equal(circuit, revokeOne ? 'revoke_grant_with_p256' : 'revoke_all_grants_with_p256');
        assert.equal(args.length, revokeOne ? 2 : 1);
        const auth = /** @type {{ use_counter: bigint; policy: typeof policy }} */ (
          args[revokeOne ? 1 : 0]
        );
        assert.equal(auth.use_counter, counter);
        assert.deepEqual(auth.policy, policy);
        counter++;
        nonce++;
        if (revokeOne) entries = [{ id: grantId, active: false, read }];
        else {
          generation++;
          entries = [];
        }
        return { txHash: 'tx-1' };
      },
    },
    grantRoster: {
      readGrantRoster: async () => ({
        authNonce: stale ? nonce - 1n : nonce,
        generation,
        entries: [...entries],
      }),
    },
    grantDetails: {
      readGrant: async (_account, id) => {
        const grant = entries.find((entry) => entry.id === id);
        return (
          grant && { active: grant.active, read: grant.read, authNonce: stale ? nonce - 1n : nonce }
        );
      },
    },
    directory: { get: async () => hint, put: async () => {} },
    deployer: {
      deploy: async () => {
        throw new Error('unexpected deploy');
      },
    },
    random: (length) => new Uint8Array(length).fill(3),
  };
  return { accounts: createPassportAccounts(ports), signed: () => signed, calls: () => calls };
}

test('P-256 owner clears spend grants with the pinned challenge and confirms generation', async () => {
  const w = world();
  const account = await w.accounts.openAccount();
  assert.ok(account.revokeAllGrants);
  const result = await account.revokeAllGrants();
  assert.equal(result.status, 'cleared');
  assert.equal(result.generation, 8n);
  assert.equal(result.nextUseCounter, 3n);
  assert.equal(result.txHash, 'tx-1');
  assert.equal(w.signed(), 1);
  assert.equal(w.calls(), 1);
});

test('P-256 owner revokes one spend grant without rotating its viewing key', async () => {
  const w = world({ revokeOne: true });
  const account = await w.accounts.openAccount();
  const result = await account.revokeGrant?.(grantId);
  assert.equal(result?.status, 'revoked');
  assert.equal(result.grantId, grantId);
  assert.equal(result.rotation, undefined);
  assert.equal(result.nextUseCounter, 3n);
  assert.equal(w.signed(), 1);
  assert.equal(w.calls(), 1);
});

test('P-256 revoke-all refuses read grants and stale rosters before signing', async () => {
  for (const options of [{ read: true }, { stale: true }]) {
    const w = world(options);
    const account = await w.accounts.openAccount();
    assert.ok(account.revokeAllGrants);
    await assert.rejects(account.revokeAllGrants(), {
      code: options.read ? 'BindingUnsupported' : 'GrantRosterUnsettled',
    });
    assert.equal(w.signed(), 0);
    assert.equal(w.calls(), 0);
  }
});

test('P-256 revoke-all refuses a grant-map change during the passkey prompt', async () => {
  const w = world({ changeAfterSign: true });
  const account = await w.accounts.openAccount();
  assert.ok(account.revokeAllGrants);
  await assert.rejects(account.revokeAllGrants(), { code: 'GrantRosterUnsettled' });
  assert.equal(w.signed(), 1);
  assert.equal(w.calls(), 0);
});
