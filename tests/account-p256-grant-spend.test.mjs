import assert from 'node:assert/strict';
import { createHash, sign } from 'node:crypto';
import { test } from 'node:test';
import { p256 } from '@noble/curves/nist.js';
import {
  prepareP256UnshieldedGrant,
  spendUnshieldedWithP256Grant,
} from '../packages/account/dist/index.js';
import { clientDataJSON, parseES256Signature } from '../packages/adapter-webauthn/dist/index.js';
import { pureCircuits as pure } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { createMidnightGrantSource } from '../packages/adapter-midnight-js/dist/index.js';
import { AccSimulator, simulationDevice } from '../scripts/qualification/acc-simulator.mjs';

const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString('hex');
const bytes = (/** @type {string} */ value) => Buffer.from(value, 'hex');
/**
 * @param {Extract<ReturnType<typeof simulationDevice>, {arm:'p256'}>} device
 * @param {Uint8Array} challenge
 */
function signAssertion(device, challenge) {
  const policy = device.policy;
  const data = new Uint8Array(37);
  data.set(policy.rp_id_hash);
  data[32] = 5;
  const message = Buffer.concat([
    data,
    createHash('sha256').update(clientDataJSON(challenge, policy.origin)).digest(),
  ]);
  return {
    pk: { ...device.pk, identity: /** @type {const} */ (false) },
    policy,
    authenticator_data: data,
    sig: parseES256Signature(sign('sha256', message, device.privateKey)),
  };
}

test('P-256 grantee spends on the generated ACC and the SDK retains the original receipt', async () => {
  const origin = 'http://localhost:5173';
  const owner = simulationDevice('p256');
  const grantee = simulationDevice('p256');
  assert.equal(owner.arm, 'p256');
  assert.equal(grantee.arm, 'p256');
  assert.notDeepEqual(owner.pk, grantee.pk);
  const sim = await AccSimulator.create({ owner });
  const color = new Uint8Array(32).fill(34);
  const recipient = { bytes: new Uint8Array(32).fill(56) };
  const prepared = prepareP256UnshieldedGrant(
    {
      scope: {
        account: sim.address,
        grantee: {
          scheme: 'p256-webauthn',
          publicKey: hex(p256.Point.fromAffine(grantee.pk).toBytes(true)),
          origin,
          rpIdHash: hex(grantee.policy.rp_id_hash),
        },
        color: hex(color),
        recipient: hex(recipient.bytes),
        maxCoinValue: '10',
        perCallCap: '5',
        cap: '9',
        expiresAt: sim.now + 60,
      },
      activeGrantIds: [],
      nowSeconds: sim.now,
    },
    pure,
    () => new Uint8Array(32).fill(27),
  );

  const id = bytes(prepared.opening.grantId);
  const salt = bytes(prepared.opening.scopeSalt);
  const ownerKey = { ...owner.pk, identity: false };
  const issueChallenge = pure.challenge_issue_grant_with_p256(
    sim.self,
    ownerKey,
    id,
    prepared.scopeDigest,
    sim.ledger().auth_nonce,
  );
  await sim.call('deposit_unshielded', color, 20n);
  await sim.call('issue_grant_with_p256', id, ...prepared.scopeArgs, salt, {
    ...signAssertion(owner, issueChallenge),
    use_counter: 0n,
  });

  const source = createMidnightGrantSource({
    network: {
      networkId: 'undeployed',
      bindingId: 'acc-s3r1.1',
      indexerUrl: 'http://localhost:8088/api/v1/graphql',
      indexerWsUrl: 'ws://localhost:8088/api/v1/graphql/ws',
    },
    binding: { ledger: () => sim.ledger() },
    openings: { readReadPublicKey: async () => undefined },
    publicDataProvider: /** @type {any} */ ({ queryContractState: async () => ({ data: {} }) }),
  });
  const effects = /** @type {string[]} */ ([]);
  /** @type {{txHash?:string}|undefined} */
  let row;
  const requestId = '549bd843-0a8f-40af-9b6f-d9eb8cf48871';
  const credentialId = new Uint8Array([1, 2, 3]);
  /** @type {import('../packages/account/dist/index.js').P256GrantSpendPorts} */
  const ports = {
    source,
    networkId: 'undeployed',
    pure,
    grantee: {
      credentialId,
      publicKey: { ...grantee.pk, identity: false },
      policy: grantee.policy,
    },
    nowSeconds: () => sim.now,
    sleep: async () => assert.fail('expected immediate settlement'),
    review: async (intent) => {
      assert.equal(intent.recipient, prepared.opening.scope.recipient);
      assert.equal(intent.amount, '4');
      assert.equal(intent.remainingCap, '9');
      effects.push('review');
      return true;
    },
    passkey: {
      async sign(credential, challenge) {
        assert.deepEqual(credential.credentialId, credentialId);
        effects.push('sign');
        return signAssertion(grantee, challenge);
      },
    },
    journal: {
      async read() {
        return row;
      },
      async reserve(record) {
        assert.equal(record.requestId, requestId);
        assert.match(record.intentSha256, /^[0-9a-f]{64}$/);
        assert.equal(record.previousNonce, '0');
        assert.equal(record.expectedSpentCommit, hex(pure.derive_grant_spent_commit(salt, 4n)));
        effects.push('reserve');
        if (row) return false;
        row = {};
        return true;
      },
      async recordTransaction(record, txHash) {
        assert.equal(record.requestId, requestId);
        assert.ok(row);
        row.txHash = txHash;
        effects.push('record');
      },
    },
    chain: {
      async call(call) {
        assert.equal(call.circuit, 'withdraw_unshielded_with_grant_p256');
        assert.equal(call.mutation?.requestId, requestId);
        assert.ok(row);
        effects.push('submit');
        await sim.call(call.circuit, ...call.args);
        return { txHash: 'simulated-original-transaction' };
      },
    },
  };
  const intent = { opening: prepared.opening, amount: '4', spentPrev: '0', requestId };
  const otherPolicy = { ...ports.grantee.policy, rp_id_hash: new Uint8Array(32).fill(3) };
  await assert.rejects(
    spendUnshieldedWithP256Grant(intent, {
      ...ports,
      grantee: { ...ports.grantee, policy: otherPolicy },
    }),
    { code: 'NotAuthorised' },
  );
  const read = source.readP256GrantSpendContext;
  await assert.rejects(
    spendUnshieldedWithP256Grant(intent, {
      ...ports,
      source: {
        async readP256GrantSpendContext(account, grantId) {
          const live = await read(account, grantId);
          return live && { ...live, callerCommit: new Uint8Array(32).fill(3) };
        },
      },
    }),
    { code: 'GrantScopeInvalid' },
  );
  assert.deepEqual(effects, []);
  const result = await spendUnshieldedWithP256Grant(intent, ports);
  assert.equal(result.grantNonce, 1n);
  assert.equal(result.spentTotal, 4n);
  assert.equal(sim.ledger().unshielded_balances.lookup(color), 16n);
  assert.deepEqual(effects, ['review', 'sign', 'reserve', 'submit', 'record']);
  await assert.rejects(spendUnshieldedWithP256Grant(intent, ports), {
    code: 'MutationUnsettled',
    requestId,
    txHash: result.txHash,
  });
  assert.deepEqual(effects, ['review', 'sign', 'reserve', 'submit', 'record']);

  const next = { ...intent, spentPrev: '4', requestId: '549bd843-0a8f-40af-9b6f-d9eb8cf48872' };
  let reads = 0;
  let nextReserved = false;
  let nextSends = 0;
  /** @type {import('../packages/account/dist/index.js').P256GrantSpendPorts} */
  const nextPorts = {
    ...ports,
    review: async (reviewed) => {
      assert.equal(reviewed.remainingCap, '5');
      return true;
    },
    journal: {
      async read() {
        return nextReserved ? {} : undefined;
      },
      async reserve(original) {
        assert.equal(original.requestId, next.requestId);
        assert.equal(original.previousNonce, '1');
        assert.equal(original.expectedSpentCommit, hex(pure.derive_grant_spent_commit(salt, 8n)));
        if (nextReserved) return false;
        nextReserved = true;
        return true;
      },
      async recordTransaction() {
        assert.fail('the host response was lost');
      },
    },
    chain: {
      async call(call) {
        assert.ok(nextReserved);
        assert.equal(call.mutation?.requestId, next.requestId);
        nextSends++;
        await sim.call(call.circuit, ...call.args);
        throw new Error('Submission response lost');
      },
    },
  };
  await assert.rejects(
    spendUnshieldedWithP256Grant(next, {
      ...nextPorts,
      source: {
        async readP256GrantSpendContext(account, grantId) {
          const live = await read(account, grantId);
          return live && ++reads === 3 ? { ...live, deviceEpoch: live.deviceEpoch + 1n } : live;
        },
      },
    }),
    { code: 'GrantRevoked' },
  );
  assert.equal(nextReserved, false);
  assert.equal(nextSends, 0);
  await assert.rejects(spendUnshieldedWithP256Grant(next, nextPorts), {
    code: 'MutationUnsettled',
    requestId: next.requestId,
  });
  const eventsAfterLostResponse = effects.length;
  await assert.rejects(spendUnshieldedWithP256Grant(next, nextPorts), {
    code: 'MutationUnsettled',
    requestId: next.requestId,
  });
  assert.equal(effects.length, eventsAfterLostResponse);
  assert.equal(nextSends, 1);
  assert.equal(sim.ledger().grants.lookup(id).nonce, 2n);
  assert.equal(sim.ledger().unshielded_balances.lookup(color), 12n);
});
