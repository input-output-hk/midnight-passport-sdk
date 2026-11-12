import assert from 'node:assert/strict';
import { createHash, sign } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { x25519 } from '@noble/curves/ed25519.js';
import {
  appendShieldedChange,
  createShieldedBackfillJournal,
  mutationDigest,
  recoverShieldedBackfill,
  resumeShieldedBackfill,
} from '../packages/account/dist/index.js';
import { AmountSchema, NetworkIdSchema } from '../packages/account/dist/validation.js';
import { deriveMidnightContractCoinCommitment } from '../packages/adapter-midnight-js/dist/index.js';
import { clientDataJSON, parseES256Signature } from '../packages/adapter-webauthn/dist/index.js';
import { openInboxCoin, sealInboxCoin } from '../packages/keys/dist/inbox-coin.js';
import { signJubjubChallenge } from '../packages/keys/dist/jubjub-signing.js';
import {
  fileMutationByteStore,
  protectedMutationByteStore,
} from '../packages/service/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { AccSimulator, simulationDevice } from '../scripts/qualification/acc-simulator.mjs';

const requestId = 'ca389868-7a7c-4b85-8219-4abc95833afd';
const withdrawalTxHash = '61'.repeat(32);
const appendTxHash = '62'.repeat(32);
const networkId = NetworkIdSchema.parse('undeployed');
const bindingId = /** @type {const} */ ('acc-s3r1.1');
const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString('hex');
const changeIndex = 51n;

/** @param {ReturnType<typeof simulationDevice>} owner @param {() => void} onSign */
function authoriser(owner, onSign) {
  const credentialId = new Uint8Array([1, 2, 3]);
  /** @type {import('../packages/account/dist/ports/index.js').AuthScheme} */
  const scheme = owner.arm === 'p256' ? 'p256-webauthn' : 'jubjub-schnorr';
  /** @type {import('../packages/account/dist/ports/index.js').Authoriser} */
  const port = {
    scheme,
    devicePublicKey: async () => owner.pk,
    async withKeySession(work, descriptor) {
      assert.equal(descriptor?.kind, 'backfill-shielded-change');
      return work();
    },
    async deviceBinding() {
      assert.equal(owner.arm, 'p256');
      return { credentialId, policy: owner.policy };
    },
    async authorise(request) {
      onSign();
      if (owner.arm === 'jubjub') {
        assert.ok(typeof request.challenge === 'function');
        return signJubjubChallenge(
          pureCircuits,
          owner.scalar,
          request.challenge,
          request.useCounter,
        );
      }
      assert.deepEqual(request.credentialId, credentialId);
      assert.ok(request.challenge instanceof Uint8Array);
      const authenticatorData = new Uint8Array(37);
      authenticatorData.set(owner.policy.rp_id_hash);
      authenticatorData[32] = 5;
      const message = Buffer.concat([
        authenticatorData,
        createHash('sha256')
          .update(clientDataJSON(request.challenge, owner.policy.origin))
          .digest(),
      ]);
      return {
        scheme: 'p256-webauthn',
        pk: owner.pk,
        useCounter: request.useCounter,
        authenticatorData,
        sig: parseES256Signature(sign('sha256', message, owner.privateKey)),
      };
    },
  };
  return { port, scheme, credentialId };
}

/** @param {AccSimulator} sim @param {ReturnType<typeof simulationDevice>} owner */
async function originalWithdrawal(sim, owner) {
  const sourceCoin = {
    nonce: new Uint8Array(32).fill(3),
    color: new Uint8Array(32).fill(4),
    value: 19n,
  };
  const recipient = { bytes: new Uint8Array(32).fill(5) };
  const held = { ...sourceCoin, mt_index: 17n };
  await sim.call('deposit_shielded', sourceCoin, new Uint8Array(192).fill(1));
  sim.heldCoin = held;
  const outcome = await sim.authorised(
    'withdraw_shielded',
    [recipient, held.color, 7n],
    owner,
    0n,
    [held],
  );
  assert.equal(outcome.is_some, true);
  /** @type {import('../packages/account/dist/ports/index.js').ShieldedCoin} */
  const change = outcome.value;
  const changeCommitment = deriveMidnightContractCoinCommitment(sim.address, change);
  const claims = sim.lastEffects;
  assert.ok(claims && changeCommitment);
  const [inputNullifier] = claims.claimedNullifiers;
  const payoutCommitment = claims.claimedShieldedSpends.find((value) => value !== changeCommitment);
  assert.ok(inputNullifier && payoutCommitment);
  const circuit = /** @type {const} */ (`withdraw_shielded_with_${owner.arm}`);
  const reservation = {
    requestId,
    networkId,
    bindingId,
    account: sim.address,
    circuit,
    inputNullifier,
    payoutCommitment,
    changeCommitment,
    callArgsSha256: '63'.repeat(32),
    change: { color: hex(change.color), nonce: hex(change.nonce), value: AmountSchema.parse('12') },
  };
  const dispatch = {
    identity: {
      txHash: withdrawalTxHash,
      bytesSha256: '64'.repeat(32),
      identifiers: ['65'.repeat(32)],
    },
    callCommitment: '66'.repeat(32),
  };
  /** @type {import('../packages/account/dist/index.js').ShieldedWithdrawalRecoveryPorts} */
  const withdrawal = {
    journal: { read: async () => ({ reservation, dispatch }) },
    deriveChangeCommitment: deriveMidnightContractCoinCommitment,
    finality: {
      networkId,
      bindingId,
      async readFinalized(identity) {
        assert.deepEqual(identity, dispatch.identity);
        return {
          dispatch,
          bindingId,
          blockHash: '67'.repeat(32),
          blockHeight: 10,
          account: sim.address,
          circuit,
          inputNullifier,
          outputCommitments: [payoutCommitment, changeCommitment],
          changeOutput: { account: sim.address, commitment: changeCommitment, index: changeIndex },
        };
      },
    },
  };
  return { change, changeCommitment, sourceCoin, withdrawal };
}

for (const arm of /** @type {const} */ (['p256', 'jubjub'])) {
  test(`durable ${arm} change backfill resumes the original after restart and recovers a lost reply`, async (t) => {
    const owner = simulationDevice(arm);
    let viewingKey = x25519.keygen();
    const sim = await AccSimulator.create({ owner, encKey: viewingKey.publicKey });
    const original = await originalWithdrawal(sim, owner);
    const dir = await mkdtemp(join(tmpdir(), 'passport-shielded-backfill-'));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const storageKey = new Uint8Array(32).fill(9);
    const store = protectedMutationByteStore(join(dir, 'records'), storageKey);
    t.after(() => store.close());
    const fence = fileMutationByteStore(join(dir, 'fence'));
    let journal = createShieldedBackfillJournal(store, fence);
    let signatures = 0;
    let submissions = 0;
    let unavailable = true;
    /** @type {string | undefined} */
    let originalAppendId;
    let seals = 0;
    let unspent = true;
    let rotate = arm === 'p256';
    let rotateAfterSign = arm === 'p256';
    const signer = authoriser(owner, () => signatures++);
    /** @type {Awaited<ReturnType<import('../packages/account/dist/index.js').ShieldedBackfillFinalitySource['readOriginalAppend']>>} */
    let seen;
    /** @type {import('../packages/account/dist/index.js').ShieldedBackfillPorts} */
    const ports = {
      withdrawal: original.withdrawal,
      journal,
      owner: {
        address: sim.address,
        status: 'active',
        publicKey: owner.pk,
        scheme: signer.scheme,
        ...(owner.arm === 'p256' && { credentialId: signer.credentialId, policy: owner.policy }),
      },
      authoriser: signer.port,
      pure: pureCircuits,
      async sealCoin(key, coin) {
        seals++;
        assert.deepEqual(key, viewingKey.publicKey);
        assert.deepEqual(coin, original.change);
        return sealInboxCoin(key, coin);
      },
      async isUnspent(address, coin) {
        assert.equal(address, sim.address);
        assert.deepEqual(coin, { ...original.change, mt_index: changeIndex });
        if (unspent && rotateAfterSign && signatures === 1) {
          rotateAfterSign = false;
          viewingKey = x25519.keygen();
          await sim.authorised('rotate_enc_key', [viewingKey.publicKey], owner, 2n);
        }
        return unspent;
      },
      async review(input) {
        assert.deepEqual(input, {
          account: sim.address,
          withdrawalTxHash,
          amount: '12',
          color: hex(original.change.color),
        });
        if (rotate) {
          rotate = false;
          viewingKey = x25519.keygen();
          await sim.authorised('rotate_enc_key', [viewingKey.publicKey], owner, 1n);
        }
        return true;
      },
      chain: {
        networkId,
        bindingId,
        async readAccount(address) {
          assert.equal(address, sim.address);
          const live = sim.ledger();
          return {
            booted: live.booted,
            specVersion: Number(live.spec_version),
            authNonce: live.auth_nonce,
            deviceEpoch: live.device_epoch,
            entryCount: Number(live.devices.size()),
            encKey: live.enc_key,
            inboxEntries: Array.from({ length: Number(live.inbox_count) }, (_, i) =>
              live.inbox.lookup(BigInt(i)),
            ),
            hasEntry: (entry) => live.devices.member(entry),
          };
        },
        async call(call) {
          assert.equal(call.circuit, `append_inbox_with_${arm}`);
          assert.ok(call.mutation);
          const record = await journal.read({
            networkId,
            account: sim.address,
            commitment: original.changeCommitment,
          });
          assert.equal(record?.appendId, call.mutation.requestId);
          assert.equal(mutationDigest(record), call.mutation.intentSha256);
          assert.equal(record?.callArgsSha256, mutationDigest(call.args));
          if (unavailable) {
            originalAppendId = call.mutation.requestId;
            throw new Error('synthetic failure before host dispatch');
          }
          assert.equal(call.mutation.requestId, originalAppendId);
          submissions++;
          // A permissionless deposit can advance the inbox without consuming the owner's nonce.
          await sim.call(
            'deposit_shielded',
            {
              ...original.sourceCoin,
              nonce: new Uint8Array(32).fill(7),
            },
            new Uint8Array(192).fill(7),
          );
          const inboxIndex = Number(sim.ledger().inbox_count);
          await sim.call(call.circuit, ...call.args);
          const entry = sim.ledger().inbox.lookup(BigInt(inboxIndex));
          seen = {
            appendId: call.mutation.requestId,
            intentSha256: call.mutation.intentSha256,
            account: sim.address,
            circuit: /** @type {const} */ (`append_inbox_with_${arm}`),
            callArgsSha256: mutationDigest(call.args),
            entrySha256: createHash('sha256').update(entry).digest('hex'),
            txHash: appendTxHash,
            inboxIndex,
          };
          throw new Error('synthetic lost append reply');
        },
      },
      appendFinality: { networkId, bindingId, readOriginalAppend: async () => seen },
    };
    unspent = false;
    await assert.rejects(appendShieldedChange(requestId, ports), { code: 'MutationUnsettled' });
    assert.deepEqual([signatures, seals, submissions], [0, 0, 0]);
    unspent = true;
    if (arm === 'p256') {
      await assert.rejects(appendShieldedChange(requestId, ports), { code: 'MutationUnsettled' });
      assert.deepEqual([signatures, seals, submissions], [0, 0, 0]);
      await assert.rejects(appendShieldedChange(requestId, ports), { code: 'MutationUnsettled' });
      assert.deepEqual([signatures, seals, submissions], [1, 1, 0]);
    }
    await assert.rejects(appendShieldedChange(requestId, ports), { code: 'MutationUnsettled' });
    assert.ok(originalAppendId);
    const completedCounts = arm === 'p256' ? [2, 2, 1] : [1, 1, 1];
    assert.deepEqual([signatures, seals, submissions], [...completedCounts.slice(0, 2), 0]);
    store.close();
    const restored = protectedMutationByteStore(join(dir, 'records'), storageKey);
    t.after(() => restored.close());
    const restarted = createShieldedBackfillJournal(restored, fence);
    journal = restarted;
    const readOnly = {
      withdrawal: original.withdrawal,
      chain: ports.chain,
      journal: restarted,
      appendFinality: ports.appendFinality,
    };
    /** @type {import('../packages/account/dist/index.js').ShieldedBackfillResumePorts} */
    const resumePorts = {
      ...readOnly,
      isUnspent: ports.isUnspent,
      async reviewResume(review) {
        assert.equal(review.appendId, originalAppendId);
        assert.equal(review.account, sim.address);
        assert.equal(review.networkId, networkId);
        assert.equal(review.bindingId, bindingId);
        assert.equal(review.color, hex(original.change.color));
        assert.equal(review.amount, original.change.value.toString());
        assert.equal(review.withdrawalTxHash, withdrawalTxHash);
        return true;
      },
      async resumeOriginalAppend({ original: retained, args, intentSha256 }) {
        assert.equal(retained.appendId, originalAppendId);
        assert.equal(mutationDigest(retained), intentSha256);
        return ports.chain.call({
          address: retained.account,
          circuit: retained.circuit,
          args,
          mutation: { requestId: retained.appendId, intentSha256 },
        });
      },
    };
    unavailable = false;
    assert.deepEqual(
      await resumeShieldedBackfill(requestId, {
        ...resumePorts,
        journal: { read: restarted.read, reserve: restarted.reserve },
        reviewResume: async () => assert.fail('A legacy journal cannot resume.'),
      }),
      { kind: 'unknown' },
    );
    const resumeSlot = { networkId, account: sim.address, commitment: original.changeCommitment };
    const continuation = await restarted.readContinuation?.(resumeSlot);
    assert.ok(continuation);
    await assert.rejects(
      resumeShieldedBackfill(requestId, {
        ...resumePorts,
        journal: {
          ...restarted,
          readContinuation: async () => ({ ...continuation, signedArgs: '[]' }),
        },
        reviewResume: async () =>
          assert.fail('Changed signed arguments must be refused before review.'),
      }),
      { code: 'MutationUnsettled' },
    );

    await assert.rejects(
      resumeShieldedBackfill(requestId, {
        ...resumePorts,
        reviewResume: async () => false,
      }),
      { code: 'UserCancelled' },
    );
    const controller = new AbortController();
    const options = { signal: controller.signal };
    await assert.rejects(
      resumeShieldedBackfill(
        requestId,
        {
          ...resumePorts,
          async reviewResume() {
            options.signal = new AbortController().signal;
            controller.abort();
            return true;
          },
          resumeOriginalAppend: async () =>
            assert.fail('Aborting the original signal prevents dispatch.'),
        },
        options,
      ),
      { code: 'Aborted' },
    );
    const expectedView = await ports.chain.readAccount(sim.address);
    assert.ok(expectedView);
    for (const delta of [
      { encKey: new Uint8Array(32).fill(42) },
      { authNonce: expectedView.authNonce + 1n },
      { deviceEpoch: expectedView.deviceEpoch + 1n },
      { hasEntry: () => false },
      { inboxEntries: [...(expectedView.inboxEntries ?? []), new Uint8Array(192)] },
    ]) {
      assert.deepEqual(
        await resumeShieldedBackfill(requestId, {
          ...resumePorts,
          chain: { ...ports.chain, readAccount: async () => ({ ...expectedView, ...delta }) },
        }),
        { kind: 'unknown' },
      );
    }
    assert.deepEqual(
      await resumeShieldedBackfill(requestId, {
        ...resumePorts,
        isUnspent: async () => false,
      }),
      { kind: 'unknown' },
    );
    assert.equal(submissions, 0);
    const confirmed = {
      kind: 'confirmed',
      requestId,
      appendId: originalAppendId,
      txHash: appendTxHash,
      inboxIndex: 2,
    };
    assert.deepEqual(await resumeShieldedBackfill(requestId, resumePorts), confirmed);
    assert.deepEqual([signatures, seals, submissions], completedCounts);
    assert.ok(seen);
    assert.equal(seen.inboxIndex, 2);
    const entry = sim.ledger().inbox.lookup(2n);
    assert.deepEqual(await openInboxCoin(viewingKey.secretKey, entry), original.change);
    assert.deepEqual(sim.lastEffects?.claimedShieldedReceives, []);
    assert.deepEqual(sim.lastEffects?.claimedNullifiers, []);
    assert.deepEqual(await recoverShieldedBackfill(requestId, readOnly), confirmed);
    const legacyStore = protectedMutationByteStore(join(dir, 'legacy'), storageKey);
    t.after(() => legacyStore.close());
    const legacy = createShieldedBackfillJournal(
      legacyStore,
      fileMutationByteStore(join(dir, 'legacy-fence')),
    );
    const originalRecord = await restarted.read(resumeSlot);
    assert.ok(originalRecord);
    assert.equal('signedArgs' in originalRecord, false);
    assert.equal(await legacy.reserve(originalRecord), true);
    assert.equal(await legacy.readContinuation?.(resumeSlot), undefined);
    assert.deepEqual(
      await recoverShieldedBackfill(requestId, { ...readOnly, journal: legacy }),
      confirmed,
    );
    assert.deepEqual(
      await resumeShieldedBackfill(requestId, {
        ...resumePorts,
        reviewResume: async () => assert.fail('A finalized append is read only.'),
      }),
      confirmed,
    );
    seen = { ...seen, inboxIndex: 1 };
    assert.deepEqual(await recoverShieldedBackfill(requestId, readOnly), { kind: 'unknown' });
    await assert.rejects(appendShieldedChange(requestId, { ...ports, journal: restarted }), {
      code: 'MutationUnsettled',
    });
    const empty = protectedMutationByteStore(join(dir, 'lost'), storageKey);
    t.after(() => empty.close());
    await assert.rejects(
      appendShieldedChange(requestId, {
        ...ports,
        journal: createShieldedBackfillJournal(empty, fence),
      }),
      { code: 'MutationUnsettled' },
    );
    assert.deepEqual([signatures, seals, submissions], completedCounts);
  });
}
