import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createSoftwareIdentity,
  softwareParticipant,
} from '../scripts/qualification/identities.mjs';
import { encodeMutationValue, decodeMutationValue } from '../packages/account/dist/index.js';
import { FAKE_POLICY, verifyP256 } from '../packages/account/dist/testing/index.js';

for (const arm of /** @type {const} */ (['p256', 'jubjub']))
  test(`${arm}: three persisted qualification identities remain distinct across restart`, async () => {
    const material = await Promise.all([0, 1, 2].map(() => createSoftwareIdentity()));
    const first = await Promise.all(material.map((m) => softwareParticipant(m, arm).reader()));
    assert.equal(new Set(first.map((r) => r.readerPublicKey)).size, 3);
    assert.equal(new Set(first.map((r) => r.devicePublicKey)).size, 3);
    const restored = /** @type {Awaited<ReturnType<typeof createSoftwareIdentity>>[]} */ (
      decodeMutationValue(JSON.parse(JSON.stringify(encodeMutationValue(material))))
    );
    const second = await Promise.all(restored.map((m) => softwareParticipant(m, arm).reader()));
    assert.deepEqual(second, first);
    const credentials = await Promise.all(
      material.map((m) => softwareParticipant(m, arm).credentials.identify()),
    );
    assert.equal(
      new Set(credentials.map((c) => Buffer.from(c.credentialId).toString('hex'))).size,
      3,
    );
    const reopened = await Promise.all(
      restored.map((m) => softwareParticipant(m, arm).credentials.identify()),
    );
    for (let i = 0; i < 3; i++) {
      const identity = restored[i],
        otherIdentity = restored[(i + 1) % 3];
      const original = credentials[i],
        after = reopened[i];
      assert.ok(identity && otherIdentity && original && after);
      assert.deepEqual(after.credentialId, original.credentialId);
      const own = softwareParticipant(identity, arm).authoriser;
      assert.equal(
        original.owns(await own.devicePublicKey(), arm === 'p256' ? FAKE_POLICY : undefined),
        true,
      );
      const other = softwareParticipant(otherIdentity, arm).authoriser;
      assert.equal(
        original.owns(await other.devicePublicKey(), arm === 'p256' ? FAKE_POLICY : undefined),
        false,
      );
    }
  });

test('qualification P-256 identity signs its own strict policy and refuses another pinned credential', async () => {
  const material = await createSoftwareIdentity();
  const a = softwareParticipant(material, 'p256').authoriser;
  const input = {
    circuit: 'qualification',
    account: 'ab'.repeat(32),
    args: [],
    witnessValues: [],
    authNonce: 0n,
    useCounter: 0n,
    challenge: new Uint8Array(32).fill(42),
    credentialId: material.credential,
  };
  const signed = await a.authorise(input);
  assert.equal(signed.scheme, 'p256-webauthn');
  assert.equal(await verifyP256(signed, input.challenge, FAKE_POLICY), true);
  await assert.rejects(a.authorise({ ...input, credentialId: new Uint8Array(16) }), {
    code: 'WrongPasskey',
  });
});
