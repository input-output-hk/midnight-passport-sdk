import assert from 'node:assert/strict';
import { createHash, sign } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { p256 } from '@noble/curves/nist.js';
import {
  createP256GranteeIssueFence,
  createP256GranteeIssueJournal,
  issueP256GranteeGrant,
  recoverIssuedP256Grant,
} from '../packages/account/dist/index.js';
import { createMidnightGrantSource } from '../packages/adapter-midnight-js/dist/index.js';
import { clientDataJSON, parseES256Signature } from '../packages/adapter-webauthn/dist/index.js';
import { signJubjubChallenge } from '../packages/keys/dist/jubjub-signing.js';
import {
  fileMutationByteStore,
  protectedMutationByteStore,
} from '../packages/service/dist/index.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { AccSimulator, simulationDevice } from '../scripts/qualification/acc-simulator.mjs';

const requestId = '549bd843-0a8f-40af-9b6f-d9eb8cf48871';
const txHash = '21'.repeat(32);
const networkId = 'undeployed';
const bindingId = 'acc-s3r1.1';
const hex = (/** @type {Uint8Array} */ bytes) => Buffer.from(bytes).toString('hex');

for (const arm of /** @type {const} */ (['p256', 'jubjub'])) {
  test(`durable P-256 grantee issue executes under a distinct ${arm} owner`, async (t) => {
    const owner = simulationDevice(arm);
    const sim = await AccSimulator.create({ owner });
    const grantee = simulationDevice('p256');
    assert.equal(grantee.arm, 'p256');
    const root = await mkdtemp(join(tmpdir(), 'passport-p256-grantee-issue-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const fenceRoot = await mkdtemp(join(tmpdir(), 'passport-p256-grantee-fence-'));
    t.after(() => rm(fenceRoot, { recursive: true, force: true }));
    const fence = createP256GranteeIssueFence(fileMutationByteStore(fenceRoot));
    const key = new Uint8Array(32).fill(9);
    const protectedStore = protectedMutationByteStore(root, key);
    t.after(() => protectedStore.close());
    const journal = createP256GranteeIssueJournal(protectedStore);
    const credentialId = new Uint8Array([1, 2, 3]);
    const scheme = arm === 'p256' ? 'p256-webauthn' : 'jubjub-schnorr';
    const scope = {
      account: sim.address,
      grantee: {
        scheme: /** @type {const} */ ('p256-webauthn'),
        publicKey: hex(p256.Point.fromAffine(grantee.pk).toBytes(true)),
        origin: 'http://localhost:5173',
        rpIdHash: hex(grantee.policy.rp_id_hash),
      },
      color: '22'.repeat(32),
      recipient: '44'.repeat(32),
      maxCoinValue: '10',
      perCallCap: '5',
      cap: '9',
      expiresAt: sim.now + 60,
    };
    let reviews = 0;
    let signatures = 0;
    let submissions = 0;
    const grants = createMidnightGrantSource({
      network: {
        networkId,
        bindingId,
        indexerUrl: 'http://localhost:8088/api/v1/graphql',
        indexerWsUrl: 'ws://localhost:8088/api/v1/graphql/ws',
      },
      binding: { ledger: () => sim.ledger() },
      openings: { readReadPublicKey: async () => undefined },
      publicDataProvider: /** @type {any} */ ({ queryContractState: async () => ({ data: {} }) }),
    });
    /** @type {import('../packages/account/dist/index.js').P256GranteeIssuePorts} */
    const ports = {
      networkId,
      grants,
      journal,
      fence,
      pure: pureCircuits,
      owner: {
        scheme,
        address: sim.address,
        publicKey: owner.pk,
        status: 'active',
        ...(owner.arm === 'p256' && { credentialId, policy: owner.policy }),
      },
      authoriser: {
        scheme,
        devicePublicKey: async () => owner.pk,
        async withKeySession(work, descriptor) {
          assert.equal(descriptor?.kind, 'issue-grant');
          return work();
        },
        async deviceBinding() {
          assert.equal(owner.arm, 'p256');
          return { credentialId, policy: owner.policy };
        },
        async authorise(request) {
          signatures++;
          assert.equal(reviews, 1);
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
            hasEntry: (entry) => live.devices.member(entry),
          };
        },
        async call(request) {
          const retained = await journal.read(requestId);
          assert.ok(retained);
          assert.equal(request.mutation?.intentSha256, retained.intentSha256);
          assert.equal(request.circuit, `issue_grant_with_${arm}`);
          submissions++;
          await sim.call(request.circuit, ...request.args);
          if (arm === 'jubjub') throw new Error('Lost original response');
          return { txHash };
        },
      },
      nowSeconds: () => sim.now,
      random: () => new Uint8Array(32).fill(61),
      review: async (request) => {
        reviews++;
        assert.deepEqual(request.scope, scope);
        return true;
      },
    };
    const input = { requestId, scope };
    let reads = 0;
    await assert.rejects(
      issueP256GranteeGrant(input, {
        ...ports,
        chain: {
          ...ports.chain,
          async readAccount(address, options) {
            const view = await ports.chain.readAccount(address, options);
            return view && ++reads === 2 ? { ...view, authNonce: view.authNonce + 1n } : view;
          },
        },
        review: async () => true,
      }),
      { code: 'GrantRosterUnsettled' },
    );
    assert.deepEqual([reviews, signatures, submissions], [0, 0, 0]);
    assert.equal(await journal.read(requestId), undefined);
    assert.equal(await fence.has(requestId), false);
    if (owner.arm === 'p256') {
      const selfGrant = {
        ...scope,
        grantee: {
          ...scope.grantee,
          publicKey: hex(p256.Point.fromAffine(owner.pk).toBytes(true)),
        },
      };
      await assert.rejects(issueP256GranteeGrant({ requestId, scope: selfGrant }, ports), {
        code: 'GrantScopeInvalid',
      });
      assert.deepEqual([reviews, signatures, submissions], [0, 0, 0]);
    }
    if (arm === 'p256') {
      const result = await issueP256GranteeGrant(input, ports);
      assert.equal(result.txHash, txHash);
      assert.equal(result.nextUseCounter, 1n);
    } else {
      await assert.rejects(issueP256GranteeGrant(input, ports), {
        code: 'MutationUnsettled',
        requestId,
      });
    }
    protectedStore.close();
    const reopened = protectedMutationByteStore(root, key);
    t.after(() => reopened.close());
    const restarted = createP256GranteeIssueJournal(reopened);
    const recovered = await recoverIssuedP256Grant(requestId, { ...ports, journal: restarted });
    assert.ok(recovered);
    assert.deepEqual(recovered.opening.scope, scope);
    assert.equal(recovered.txHash, arm === 'p256' ? txHash : undefined);
    assert.equal(sim.ledger().auth_nonce, recovered.expectedIssuedAt);
    await assert.rejects(issueP256GranteeGrant(input, { ...ports, journal: restarted }), {
      code: 'MutationUnsettled',
      requestId,
    });
    assert.deepEqual([reviews, signatures, submissions], [1, 1, 1]);

    const lostRoot = await mkdtemp(join(tmpdir(), 'passport-p256-grantee-lost-'));
    t.after(() => rm(lostRoot, { recursive: true, force: true }));
    const emptyStore = protectedMutationByteStore(lostRoot, key);
    t.after(() => emptyStore.close());
    const lostJournal = createP256GranteeIssueJournal(emptyStore);
    const retainedFence = createP256GranteeIssueFence(fileMutationByteStore(fenceRoot));
    assert.equal(await lostJournal.read(requestId), undefined);
    await assert.rejects(
      issueP256GranteeGrant(input, {
        ...ports,
        journal: lostJournal,
        fence: retainedFence,
      }),
      { code: 'MutationUnsettled', requestId },
    );
    assert.deepEqual([reviews, signatures, submissions], [1, 1, 1]);

    for (const file of await readdir(root)) {
      const stored = await readFile(join(root, file), 'utf8');
      const { ciphertext } = JSON.parse(stored);
      const encrypted = Buffer.from(ciphertext, 'base64');
      assert.equal(encrypted.includes(recovered.opening.scopeSalt), false);
      assert.equal(encrypted.includes(scope.grantee.publicKey), false);
    }
    const wrongKey = protectedMutationByteStore(root, new Uint8Array(32).fill(8));
    t.after(() => wrongKey.close());
    await assert.rejects(createP256GranteeIssueJournal(wrongKey).read(requestId));
  });
}
