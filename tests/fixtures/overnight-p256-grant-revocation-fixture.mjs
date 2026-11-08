// Software ES256 and generated challenges, with explicit synthetic grant-map transport.
import assert from 'node:assert/strict';
import { x25519 } from '@noble/curves/ed25519.js';
import { pureCircuits as pure } from '../../packages/contract/generated/acc-s3r1.1/index.js';
import { verifyP256 } from '../../packages/account/dist/testing/p256.js';
import { fixture as rotationFixture, grantId, hex } from './overnight-p256-rotation-fixture.mjs';

export { grantId };
export const survivorId = 'bb'.repeat(32);
export const tombstoneId = 'cc'.repeat(32);

export async function fixture({ read = true } = {}) {
  const f = await rotationFixture();
  Object.assign(f.ports.network, { bindingId: 'acc-s3r1.1' });
  const state = {
    generation: 7n,
    entries: [
      { id: grantId, active: true, read },
      { id: survivorId, active: true, read },
      { id: tombstoneId, active: false, read: false },
    ],
    finalCalls: 0,
    finalSigns: 0,
    wrongOwner: false,
    mismatch: '',
    /** @type {Error|undefined} */ finalError: undefined,
    /** @type {(()=>void)|undefined} */ afterSign: undefined,
    /** @type {(()=>void)|undefined} */ afterHoldings: undefined,
    /** @type {(()=>Promise<void>)|undefined} */ acknowledge: undefined,
  };
  const targets = read
    ? [grantId, survivorId].map((id, index) => ({
        grantId: id,
        readPublicKey: hex(x25519.getPublicKey(new Uint8Array(32).fill(10 + index))),
      }))
    : [];
  f.setTargets(targets);
  const detailSource = {
    async readGrant(/** @type {string} */ account, /** @type {string} */ id) {
      assert.equal(this, detailSource);
      assert.equal(account, f.account.address);
      f.trace.push(`detail:${id}`);
      const entry = state.entries.find((item) => item.id === id);
      return entry && { active: entry.active, read: entry.read, authNonce: f.ledger().authNonce };
    },
  };
  const rosterSource = {
    async readGrantRoster(/** @type {string} */ account) {
      assert.equal(this, rosterSource);
      assert.equal(account, f.account.address);
      f.trace.push('full-roster');
      return {
        authNonce: f.ledger().authNonce,
        generation: state.generation,
        entries: state.entries.map((entry) => ({ ...entry })),
      };
    },
  };
  Object.assign(f.ports, { grantDetails: detailSource, grantRoster: rosterSource });
  const authorise = f.authoriser.authorise;
  f.authoriser.authorise = async function (request) {
    assert.equal(this, f.authoriser);
    const signed = await authorise.call(this, request);
    if (!request.circuit.startsWith('revoke_')) return signed;
    state.finalSigns++;
    state.afterSign?.();
    if (state.mismatch === 'counter') return { ...signed, useCounter: signed.useCounter + 1n };
    if (state.mismatch === 'key') return { ...signed, pk: { x: 1n, y: 2n } };
    if (state.mismatch === 'scheme')
      return {
        scheme: 'jubjub-schnorr',
        pk: signed.pk,
        useCounter: signed.useCounter,
        sigR: signed.pk,
        sigS: 0n,
        grindNonce: 0n,
      };
    return signed;
  };
  const publicKey = f.authoriser.devicePublicKey;
  f.authoriser.devicePublicKey = async function () {
    assert.equal(this, f.authoriser);
    if (state.wrongOwner) return { x: 1n, y: 2n };
    return publicKey.call(this);
  };
  assert.ok(typeof f.ports.chain !== 'function');
  const chain = f.ports.chain;
  const call = chain.call;
  chain.call = async function (request) {
    assert.equal(this, chain);
    if (!request.circuit.startsWith('revoke_')) {
      const tx = await call.call(this, request);
      if (request.circuit === 'append_inbox_with_p256' && f.materials.length) {
        const rotated = f.calls.some((item) => item.circuit === 'rotate_enc_key_with_p256');
        if (rotated) state.afterHoldings?.();
      }
      return tx;
    }
    state.finalCalls++;
    f.calls.push(request);
    f.trace.push(`call:${request.circuit}`);
    if (state.finalError) throw state.finalError;
    const single = request.circuit === 'revoke_grant_with_p256';
    assert.equal(request.args.length, single ? 2 : 1);
    const proof =
      /** @type {{pk:import('../../packages/account/dist/ports/index.js').P256PublicKey,policy:import('../../packages/account/dist/ports/index.js').WebAuthnPolicy,authenticator_data:Uint8Array,sig:{r:bigint,s:bigint},use_counter:bigint}} */ (
        request.args[single ? 1 : 0]
      );
    const self = { bytes: Buffer.from(request.address, 'hex') };
    const challenge = single
      ? pure.challenge_revoke_grant_with_p256(
          self,
          proof.pk,
          Buffer.from(grantId, 'hex'),
          f.ledger().authNonce,
        )
      : pure.challenge_revoke_all_grants_with_p256(self, proof.pk, f.ledger().authNonce);
    if (single) assert.deepEqual(request.args[0], new Uint8Array(Buffer.from(grantId, 'hex')));
    assert.ok(
      await verifyP256(
        { pk: proof.pk, authenticatorData: proof.authenticator_data, sig: proof.sig },
        challenge,
        proof.policy,
      ),
      'The dispatched proof must verify over the exact generated revoke challenge.',
    );
    const entry = (/** @type {bigint} */ counter) =>
      hex(
        pure.derive_device_entry_with_p256(
          self,
          proof.pk,
          proof.policy,
          f.ledger().deviceEpoch,
          counter,
        ),
      );
    assert.ok(f.ledger().entries.delete(entry(proof.use_counter)));
    f.ledger().entries.add(entry(proof.use_counter + 1n));
    f.ledger().authNonce++;
    if (single)
      state.entries = state.entries.map((item) =>
        item.id === grantId ? { ...item, active: false } : item,
      );
    else {
      state.entries = [];
      state.generation = (state.generation + 1n) & ((1n << 32n) - 1n);
    }
    await state.acknowledge?.();
    return { txHash: 'original-final-receipt', txIds: ['original-final-id'] };
  };
  return { ...f, state, targets, detailSource, rosterSource, chain };
}
