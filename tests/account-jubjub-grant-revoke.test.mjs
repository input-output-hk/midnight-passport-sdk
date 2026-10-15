import assert from 'node:assert/strict';
import { test } from 'node:test';
import { revokeJubjubGrantCall } from '../packages/account/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';

const account = 'ab'.repeat(32);
const grantId = 'cd'.repeat(32);
const owner = pureCircuits.compute_public_point_with_jubjub(7n);
const hint = {
  address: account,
  scheme: /** @type {const} */ ('jubjub-schnorr'),
  publicKey: owner,
  credentialId: Uint8Array.of(10),
  status: /** @type {const} */ ('active'),
};

function fixture() {
  /** @type {string[]} */
  const calls = [];
  /** @type {{active:boolean,read:boolean}|undefined} */
  let grant = { active: true, read: false };
  /** @type {import('../packages/account/dist/jubjub-grant-revoke.js').RevokeJubjubGrantPorts} */
  const ports = {
    bindingId: 'acc-s3r1.1',
    pure: pureCircuits,
    random: (length) => new Uint8Array(length).fill(2),
    records: {
      exists: async () => true,
      read: async () => ({
        address: account,
        bindingId: 'acc-s3r1.1',
        scheme: 'jubjub-schnorr',
        credentialId: Uint8Array.of(10),
        localUseCounter: 0n,
      }),
      write: async (next) => {
        calls.push('record');
        assert.equal(next.localUseCounter, 1n);
      },
    },
    grants: {
      readGrant: async (address, id) => {
        calls.push('roster');
        assert.equal(address, account);
        assert.equal(id, grantId);
        return grant;
      },
    },
    chain: {
      readAccount: async () => ({
        booted: true,
        specVersion: 3,
        authNonce: 5n,
        deviceEpoch: 0n,
        entryCount: 1,
        hasEntry: (entry) =>
          Buffer.from(entry).equals(
            Buffer.from(
              pureCircuits.derive_device_entry_with_jubjub(
                { bytes: Buffer.from(account, 'hex') },
                owner,
                0n,
                0n,
              ),
            ),
          ),
      }),
      call: async (request) => {
        calls.push('call');
        assert.equal(request.circuit, 'revoke_grant_with_jubjub');
        assert.equal(request.args.length, 6);
        assert.equal(
          Buffer.from(/** @type {Uint8Array} */ (request.args[0])).toString('hex'),
          grantId,
        );
        assert.equal(request.args[2], 0n);
        return { txHash: 'revoke-tx' };
      },
    },
    authoriser: {
      scheme: 'jubjub-schnorr',
      devicePublicKey: async () => owner,
      withKeySession: async (operation, flow) => {
        calls.push('session');
        assert.deepEqual(flow, { kind: 'revoke-grant', grantId });
        return operation();
      },
      authorise: async (request) => {
        calls.push('sign');
        assert.equal(request.circuit, 'revoke_grant_with_jubjub');
        if (typeof request.challenge !== 'function') throw new Error('missing challenge');
        assert.deepEqual(
          request.challenge(owner, 3n),
          pureCircuits.challenge_revoke_grant_with_jubjub(
            { bytes: Buffer.from(account, 'hex') },
            owner,
            owner,
            Buffer.from(grantId, 'hex'),
            5n,
            3n,
          ),
        );
        return {
          scheme: 'jubjub-schnorr',
          pk: owner,
          useCounter: 0n,
          sigR: owner,
          sigS: 8n,
          grindNonce: 3n,
        };
      },
    },
  };
  return {
    ports,
    calls,
    /** @param {{active:boolean,read:boolean}|undefined} value */
    setGrant: (value) => (grant = value),
  };
}

test('owner submits pinned revoke call and advances its local counter', async () => {
  const { ports, calls } = fixture();
  const result = await revokeJubjubGrantCall({ hint, grantId }, ports);
  assert.deepEqual(result, {
    txHash: 'revoke-tx',
    grantId,
    status: 'submitted',
    nextUseCounter: 1n,
  });
  assert.deepEqual(calls, ['roster', 'session', 'sign', 'roster', 'call', 'record']);
});

test('missing, revoked and read grants never enter a key session', async () => {
  /** @type {Array<[{active:boolean,read:boolean}|undefined,string]>} */
  const cases = [
    [undefined, 'GrantNotFound'],
    [{ active: false, read: false }, 'GrantRevoked'],
    [{ active: true, read: true }, 'BindingUnsupported'],
  ];
  for (const [value, code] of cases) {
    const { ports, calls, setGrant } = fixture();
    setGrant(value);
    await assert.rejects(revokeJubjubGrantCall({ hint, grantId }, ports), { code });
    assert.deepEqual(calls, ['roster']);
  }
});

test('a grant changed to read access before submission is refused', async () => {
  const { ports, calls, setGrant } = fixture();
  const sign = ports.authoriser.authorise;
  ports.authoriser.authorise = async (request) => {
    const result = await sign(request);
    setGrant({ active: true, read: true });
    return result;
  };
  await assert.rejects(revokeJubjubGrantCall({ hint, grantId }, ports), {
    code: 'BindingUnsupported',
  });
  assert.ok(!calls.includes('call'));
  assert.ok(!calls.includes('record'));
});
