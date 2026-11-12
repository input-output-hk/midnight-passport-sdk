import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import {
  AgentGrantSpendUnsettled,
  createAgentGrantSpendJournal,
  recoverAgentGrantSpend,
  spendWithDurableAgentJubjubGrant,
  issueAgentJubjubGrant,
  spendWithAgentJubjubGrant,
  verifyAgentJubjubGrantResponse,
} from '../packages/account/dist/index.js';
import { selectGrantSpendDispatch } from '../packages/adapter-midnight-js/dist/p256-grant-submitter.js';
import { recipeJubjubAuthoriser } from '../packages/keys/dist/index.js';
import { encode, ownerFixture, packet, storage } from './fixtures/agent-grant-wire.mjs';

import { barrier } from './fixtures/host-jobs.mjs';

const ledger = await import(
  pathToFileURL(
    createRequire(new URL('../packages/adapter-midnight-js/package.json', import.meta.url)).resolve(
      '@midnightntwrk/ledger-v9',
    ),
  ).href
);

/** @param {import('node:test').TestContext} t @param {{selectAccount?:boolean, cap?:string, arm?:'jubjub'|'p256'}} [options] */
async function issued(t, options = {}) {
  const { fixture, value: draft, ports: owner } = await ownerFixture(options.arm);
  const value = {
    ...draft,
    grants: draft.grants.map((grant) => ({
      ...grant,
      bounds: { ...grant.bounds, cap: options.cap ?? grant.bounds.cap },
    })),
  };
  const { account, ...unsignedAccount } = value;
  const originalRequest = packet(options.selectAccount ? unsignedAccount : value);
  const requestedAt = fixture.sim.now;
  const stores = await storage(t);
  const response = await issueAgentJubjubGrant(originalRequest, {
    ...owner,
    ...stores,
    approve: async () => true,
  });
  const requests = { originalRequest, response };
  const ports = {
    request: {
      account,
      networkId: owner.networkId,
      authoriserOrigin: owner.authoriserOrigin,
      requestedAt,
    },
    grants: owner.grants,
    nowSeconds: () => fixture.sim.now,
    pure: owner.pure,
  };
  return { fixture, value, owner, requests, ports, stores };
}

/** @param {ReturnType<typeof recipeJubjubAuthoriser>} signer */
function observeSigner(signer) {
  let sessions = 0;
  let signatures = 0;
  /** @type {import('../packages/account/dist/ports/index.js').Authoriser} */
  const authoriser = {
    ...signer,
    async withKeySession(work) {
      sessions++;
      assert.ok(signer.withKeySession);
      return signer.withKeySession(work);
    },
    async authorise(request) {
      signatures++;
      return signer.authorise(request);
    },
  };
  return { authoriser, counts: () => [sessions, signatures] };
}

/** @param {typeof import('../packages/contract/generated/acc-s3r1.1/index.js').pureCircuits} pure @param {number} scalar */
function signer(pure, scalar) {
  return observeSigner(
    recipeJubjubAuthoriser(
      {
        withSession: (work) => work(),
        deviceSecret: async () => Uint8Array.of(scalar, ...new Uint8Array(31)),
        deriveSecret: async () =>
          assert.fail('The agent signer must not derive a reader or owner key.'),
      },
      pure,
    ),
  );
}

test('the agent validates the exact return against one live read and a separately chosen ACC', async (t) => {
  const { fixture, value, ports, requests } = await issued(t, { selectAccount: true });
  fixture.sim.now = value.exp + 1;
  let reads = 0;
  const grants = {
    ...ports.grants,
    async readP256GrantSpendContext(/** @type {string} */ account, /** @type {string} */ grantId) {
      reads++;
      return ports.grants.readP256GrantSpendContext(account, grantId);
    },
  };
  const result = await verifyAgentJubjubGrantResponse(requests, { ...ports, grants });
  assert.equal(reads, 1);
  assert.equal(result.account, value.account);
  assert.equal(result.grantId, requests.response.grant_id);
  assert.equal(result.scope.perCallCap, '1');
  assert.ok(Object.isFrozen(result.issuance));
  assert.equal(result.issuance.account, value.account);
  assert.equal(result.issuance.grantId, result.grantId);
  const original = requests.response;
  const scope = JSON.parse(Buffer.from(original.scope, 'base64url').toString());
  for (const response of [
    { ...original, account: '25'.repeat(32) },
    { ...original, chain: 'midnight:preview' },
    { ...original, grant_id: '25'.repeat(32) },
    { ...original, scope_salt: '25'.repeat(32) },
    { ...original, scope: encode({ ...scope, per_call_cap: '2' }) },
    { ...original, scope: encode({ ...scope, recipient: '25'.repeat(32) }) },
    { ...original, redirect_uri: 'https://other.example' },
  ]) {
    await assert.rejects(verifyAgentJubjubGrantResponse({ ...requests, response }, ports), {
      code: 'GrantScopeInvalid',
    });
  }
  for (const originalRequest of [
    packet({ ...value, grants: value.grants.map((grant) => ({ ...grant, slot: 8 })) }),
    { ...requests.originalRequest, proof: 'AB' },
  ]) {
    await assert.rejects(verifyAgentJubjubGrantResponse({ ...requests, originalRequest }, ports), {
      code: 'GrantScopeInvalid',
    });
  }
  await assert.rejects(
    verifyAgentJubjubGrantResponse(requests, {
      ...ports,
      request: { ...ports.request, account: '93'.repeat(32) },
    }),
    { code: 'GrantScopeInvalid' },
  );
});

for (const arm of /** @type {const} */ (['jubjub', 'p256'])) {
  test(`${arm} a funded generated ACC honors an independent agent signature and the original cap and revocation`, async (t) => {
    const { fixture, owner, ports, requests } = await issued(t, { cap: '1', arm });
    const { sim, ownerAccount, effects } = fixture;
    const verified = await verifyAgentJubjubGrantResponse(requests, ports);
    const color = Buffer.from(verified.scope.color, 'hex');
    await sim.call('deposit_unshielded', color, 20n);
    const agent = signer(ports.pure, 7);
    const outsider = signer(ports.pure, 8);
    const input = { ...requests, issuance: verified.issuance, amount: '1', spentPrev: '0' };
    /** @type {import('../packages/account/dist/index.js').AgentJubjubGrantSpendPorts} */
    const spend = {
      ...ports,
      chain: owner.chain,
      grantee: agent.authoriser,
      async review(details) {
        assert.equal(details.account, verified.account);
        assert.equal(details.recipient, verified.scope.recipient.value);
        assert.equal(details.amount, '1');
        return true;
      },
      attempts: 1,
    };
    await assert.rejects(spendWithAgentJubjubGrant({ ...input, amount: '2' }, spend), {
      code: 'GrantScopeInvalid',
    });
    assert.deepEqual(agent.counts(), [0, 0]);
    await assert.rejects(
      spendWithAgentJubjubGrant(input, { ...spend, grantee: outsider.authoriser }),
      {
        code: 'NotAuthorised',
      },
    );
    assert.deepEqual(outsider.counts(), [1, 0]);
    const before = effects.length;
    const tx = await spendWithAgentJubjubGrant(input, spend);
    assert.equal(tx.spentTotal, 1n);
    assert.equal(tx.grantNonce, 1n);
    assert.deepEqual(effects.slice(before), ['withdraw_unshielded_with_grant_jubjub']);
    assert.equal(sim.ledger().unshielded_balances.lookup(color), 19n);
    await assert.rejects(spendWithAgentJubjubGrant(input, spend), { code: 'GrantScopeInvalid' });
    await assert.rejects(spendWithAgentJubjubGrant({ ...input, spentPrev: '1' }, spend), {
      code: 'GrantScopeInvalid',
      message: /remaining cap/,
    });
    assert.deepEqual(agent.counts(), [1, 1]);
    assert.ok(ownerAccount.revokeGrant);
    await ownerAccount.revokeGrant(verified.grantId);
    await assert.rejects(spendWithAgentJubjubGrant({ ...input, spentPrev: '1' }, spend), {
      code: 'GrantRevoked',
    });
    assert.deepEqual(agent.counts(), [1, 1]);
  });
}

test('expired and synthetically changed issuance cannot enter a key session', async (t) => {
  const { fixture, value, owner, ports, requests } = await issued(t);
  const verified = await verifyAgentJubjubGrantResponse(requests, ports);
  const agent = signer(ports.pure, 7);
  const input = { ...requests, issuance: verified.issuance, amount: '1', spentPrev: '0' };
  const spend = {
    ...ports,
    chain: owner.chain,
    grantee: agent.authoriser,
    review: async () => true,
  };
  const live = await ports.grants.readP256GrantSpendContext(value.account, verified.grantId);
  assert.ok(live);
  await assert.rejects(
    spendWithAgentJubjubGrant(input, {
      ...spend,
      grants: {
        ...ports.grants,
        readP256GrantSpendContext: async () => ({ ...live, issuedAt: live.issuedAt + 1n }),
      },
    }),
    { code: 'GrantScopeInvalid' },
  );
  await assert.rejects(
    spendWithAgentJubjubGrant(
      {
        ...input,
        issuance: { ...verified.issuance, account: '96'.repeat(32) },
      },
      spend,
    ),
    { code: 'GrantScopeInvalid' },
  );
  fixture.sim.now += 300;
  await assert.rejects(spendWithAgentJubjubGrant(input, spend), { code: 'GrantScopeInvalid' });
  assert.deepEqual(agent.counts(), [0, 0]);
});

test('a lost spend response preserves the original grant and nonce for reconciliation', async (t) => {
  const { fixture, owner, ports, requests } = await issued(t);
  const { sim, effects } = fixture;
  const verified = await verifyAgentJubjubGrantResponse(requests, ports);
  await sim.call('deposit_unshielded', Buffer.from(verified.scope.color, 'hex'), 20n);
  const agent = signer(ports.pure, 7);
  let offline = false;
  const grants = {
    ...ports.grants,
    readP256GrantSpendContext(/** @type {string} */ account, /** @type {string} */ grantId) {
      if (offline) throw new Error('Indexer went offline.');
      return ports.grants.readP256GrantSpendContext(account, grantId);
    },
  };
  /** @type {import('../packages/account/dist/index.js').AgentJubjubGrantSpendPorts} */
  const spend = {
    ...ports,
    grants,
    chain: {
      ...owner.chain,
      async call(call) {
        const accepted = await owner.chain.call(call);
        if (effects.filter((effect) => effect === call.circuit).length === 1)
          throw new Error('Lost original transaction response.');
        offline = true;
        return accepted;
      },
    },
    grantee: agent.authoriser,
    review: async () => true,
    attempts: 1,
  };
  const input = { ...requests, issuance: verified.issuance, amount: '1', spentPrev: '0' };
  await assert.rejects(spendWithAgentJubjubGrant(input, spend), (error) => {
    assert.ok(error instanceof AgentGrantSpendUnsettled);
    assert.equal(error.grantId, verified.grantId);
    assert.equal(error.previousGrantNonce, '0');
    assert.equal(JSON.parse(JSON.stringify(error)).previousGrantNonce, '0');
    assert.equal(error.txHash, undefined);
    return true;
  });
  await assert.rejects(spendWithAgentJubjubGrant(input, spend), { code: 'GrantScopeInvalid' });
  await assert.rejects(spendWithAgentJubjubGrant({ ...input, spentPrev: '1' }, spend), (error) => {
    assert.ok(error instanceof AgentGrantSpendUnsettled);
    assert.equal(error.previousGrantNonce, '1');
    assert.match(error.txHash ?? '', /^generated-[0-9]+$/);
    return true;
  });
  assert.deepEqual(agent.counts(), [2, 2]);
});

test('a generated ACC spend accepted before expiry retains its receipt after expiry', async (t) => {
  const { fixture, owner, ports, requests } = await issued(t);
  const { sim } = fixture;
  const verified = await verifyAgentJubjubGrantResponse(requests, ports);
  const color = Buffer.from(verified.scope.color, 'hex');
  await sim.call('deposit_unshielded', color, 20n);
  const agent = signer(ports.pure, 7);
  /** @type {import('../packages/account/dist/index.js').AgentJubjubGrantSpendPorts} */
  const spend = {
    ...ports,
    chain: {
      ...owner.chain,
      async call(call) {
        const receipt = await owner.chain.call(call);
        sim.now = verified.scope.expiresAt;
        return receipt;
      },
    },
    grantee: agent.authoriser,
    review: async () => true,
    attempts: 1,
  };
  const input = { ...requests, issuance: verified.issuance, amount: '1', spentPrev: '0' };
  const result = await spendWithAgentJubjubGrant(input, spend);
  assert.match(result.txHash, /^generated-[0-9]+$/);
  assert.equal(result.grantNonce, 1n);
  assert.equal(result.spentTotal, 1n);
  assert.equal(sim.ledger().unshielded_balances.lookup(color), 19n);
  await assert.rejects(spendWithAgentJubjubGrant({ ...input, spentPrev: '1' }, spend), {
    code: 'GrantScopeInvalid',
  });
  assert.deepEqual(agent.counts(), [1, 1]);
});

/** @param {string} account @param {string} color @param {string} recipient @param {bigint} amount */
async function payoutFixture(account, color, recipient, amount) {
  const packed = gunzipSync(
    await readFile(
      new URL('../packages/contract/resources/acc-s3r1.1.zkir.json.gz', import.meta.url),
    ),
  );
  const { files } = JSON.parse(packed.toString());
  const resource = (/** @type {string} */ key) => Buffer.from(files[key], 'base64');
  const transcript = {
    effects: {
      claimedNullifiers: [],
      claimedShieldedSpends: [],
      claimedShieldedReceives: [],
      claimedContractCalls: [],
      shieldedMints: new Map(),
      unshieldedMints: new Map(),
      unshieldedInputs: new Map(),
      unshieldedOutputs: new Map(),
      claimedUnshieldedSpends: new Map([
        [
          [
            { tag: 'unshielded', raw: color },
            { tag: 'user', address: recipient },
          ],
          amount,
        ],
      ]),
    },
    gas: { readTime: 0n, computeTime: 0n, bytesWritten: 0n, bytesDeleted: 0n },
    program: [],
  };
  const empty = { value: [], alignment: [] };
  const call = new ledger.ContractCallPrototype(
    account,
    'withdraw_unshielded_with_grant_jubjub',
    new ledger.ContractOperation(),
    transcript,
    undefined,
    [],
    empty,
    empty,
    ledger.communicationCommitmentRandomness(),
    'fixture',
  );
  return (
    await ledger.Transaction.fromParts(
      'undeployed',
      undefined,
      undefined,
      ledger.Intent.new(new Date(Date.now() + 60000)).addCall(call),
    ).prove(
      {
        check: async () => [],
        prove: async () => new ledger.Proof('0100').serialize(),
        lookupKey: async () => ({
          proverKey: new Uint8Array(),
          verifierKey: resource('keys/withdraw_unshielded_with_grant_jubjub.verifier'),
          ir: resource('zkir/withdraw_unshielded_with_grant_jubjub.bzkir'),
        }),
      },
      ledger.CostModel.initialCostModel(),
    )
  ).bind();
}

/** @param {import('node:test').TestContext} t */
async function durableFixture(t) {
  const f = await issued(t);
  const { fixture, owner, ports, requests, stores } = f;
  const verified = await verifyAgentJubjubGrantResponse(requests, ports);
  const color = Buffer.from(verified.scope.color, 'hex');
  await fixture.sim.call('deposit_unshielded', color, 20n);
  const agent = signer(ports.pure, 7);
  const receipts = createAgentGrantSpendJournal(stores.bytes);
  const input = {
    ...requests,
    requestId: randomUUID(),
    issuance: verified.issuance,
    amount: '1',
    spentPrev: '0',
  };
  return { ...f, verified, color, receipts, input, agent, chain: owner.chain };
}

test('durable agent withdrawal stages exact bytes, survives a lost reply, and fences concurrent request IDs', async (t) => {
  const f = await durableFixture(t);
  const { fixture, verified, receipts, input } = f;
  const tx = await payoutFixture(
    verified.account,
    verified.scope.color,
    verified.scope.recipient.value,
    1n,
  );
  let forwards = 0;
  let reviews = 0;
  const arrived = barrier();
  /** @type {import('../packages/account/dist/index.js').DurableAgentGrantSpendPorts} */
  const ports = {
    ...f.ports,
    receipts,
    chain: {
      ...f.chain,
      async submitDurableAgentGrantSpend(call) {
        const dispatch = await selectGrantSpendDispatch(call, 'undeployed', undefined, receipts);
        assert.ok(dispatch);
        return dispatch
          .forward(tx, dispatch.checkedCall(tx).communicationCommitment, {
            async submit(bytes) {
              forwards++;
              const row = await receipts.readRecord(call.mutation.requestId);
              assert.equal(row?.transaction?.txHash, tx.transactionHash());
              assert.deepEqual(bytes, tx.serialize());
              await f.chain.call(call);
              throw new Error('Lost acknowledgement after executing the generated ACC call.');
            },
          })
          .then((txHash) => ({ txHash }));
      },
    },
    grantee: f.agent.authoriser,
    async review() {
      if (++reviews === 2) arrived.release();
      await arrived.promise;
      return true;
    },
    attempts: 1,
  };
  const other = { ...input, requestId: randomUUID() };
  await Promise.all(
    [input, other].map((attempt) =>
      assert.rejects(spendWithDurableAgentJubjubGrant(attempt, ports), {
        code: 'MutationUnsettled',
        requestId: attempt.requestId,
      }),
    ),
  );
  assert.equal(forwards, 1);
  assert.equal(fixture.sim.ledger().unshielded_balances.lookup(f.color), 19n);
  const reopened = createAgentGrantSpendJournal(f.stores.bytes);
  const original = (await reopened.readRecord(input.requestId)) ? input : other;
  const row = await reopened.readRecord(original.requestId);
  assert.ok(row?.transaction);
  await assert.rejects(
    spendWithDurableAgentJubjubGrant(original, { ...ports, receipts: reopened }),
    {
      code: 'MutationUnsettled',
      requestId: original.requestId,
      txHash: tx.transactionHash(),
    },
  );
  const finality = {
    networkId: 'undeployed',
    readFinalized: async () => {
      assert.ok(row.transaction);
      return { ...row.transaction, blockHeight: 8 };
    },
  };
  assert.deepEqual(
    await recoverAgentGrantSpend(
      original.requestId,
      reopened,
      {
        ...finality,
        readFinalized: async () => {
          const seen = await finality.readFinalized();
          return { ...seen, bytesSha256: '82'.repeat(32) };
        },
      },
      ports.grants,
    ),
    { kind: 'unknown' },
  );
  const live = await ports.grants.readP256GrantSpendContext(verified.account, verified.grantId);
  assert.ok(live);
  assert.deepEqual(
    await recoverAgentGrantSpend(original.requestId, reopened, finality, {
      ...ports.grants,
      readP256GrantSpendContext: async () => ({ ...live, nonce: live.nonce - 1n }),
    }),
    { kind: 'unknown' },
  );
  fixture.sim.now = verified.scope.expiresAt;
  assert.deepEqual(
    await recoverAgentGrantSpend(original.requestId, reopened, finality, ports.grants),
    {
      kind: 'confirmed',
      requestId: original.requestId,
      intentSha256: row.reservation.intentSha256,
      txHash: tx.transactionHash(),
      blockHeight: 8,
    },
  );
  assert.equal(forwards, 1);
});

test('durable agent withdrawal refuses a changed payout and expiry during the dispatch write', async (t) => {
  const f = await durableFixture(t);
  const { fixture, verified, receipts, input } = f;
  t.mock.timers.enable({ apis: ['Date'], now: fixture.sim.now * 1000 });
  const changed = await payoutFixture(
    verified.account,
    verified.scope.color,
    verified.scope.recipient.value,
    2n,
  );
  const exact = await payoutFixture(
    verified.account,
    verified.scope.color,
    verified.scope.recipient.value,
    1n,
  );
  let staged = 0;
  const crossing = {
    ...receipts,
    /** @type {typeof receipts.stageTransaction} */
    async stageTransaction(original, transaction) {
      const saved = await receipts.stageTransaction(original, transaction);
      staged++;
      t.mock.timers.setTime(verified.scope.expiresAt * 1000);
      return saved;
    },
  };
  /** @type {import('../packages/account/dist/index.js').DurableAgentGrantSpendPorts} */
  const ports = {
    ...f.ports,
    receipts,
    grantee: f.agent.authoriser,
    review: async () => true,
    chain: {
      ...f.chain,
      async submitDurableAgentGrantSpend(call) {
        await assert.rejects(
          async () =>
            selectGrantSpendDispatch(
              { address: call.address, circuit: call.circuit, args: call.args },
              'undeployed',
              undefined,
              crossing,
            ),
          { code: 'MutationUnsettled' },
        );
        const dispatch = await selectGrantSpendDispatch(call, 'undeployed', undefined, crossing);
        assert.ok(dispatch);
        const submitter = {
          submit: async () => assert.fail('An invalid or expired payout was broadcast.'),
        };
        await assert.rejects(
          dispatch.forward(
            changed,
            dispatch.checkedCall(changed).communicationCommitment,
            submitter,
          ),
          {
            code: 'MutationUnsettled',
          },
        );
        assert.equal(staged, 0);
        const txHash = await dispatch.forward(
          exact,
          dispatch.checkedCall(exact).communicationCommitment,
          submitter,
        );
        return { txHash };
      },
    },
  };
  await assert.rejects(spendWithDurableAgentJubjubGrant(input, ports), {
    code: 'MutationUnsettled',
    requestId: input.requestId,
  });
  assert.equal(staged, 1);
  assert.equal(
    (await receipts.readRecord(input.requestId))?.transaction?.txHash,
    exact.transactionHash(),
  );
  assert.equal(fixture.sim.ledger().unshielded_balances.lookup(f.color), 20n);
});
