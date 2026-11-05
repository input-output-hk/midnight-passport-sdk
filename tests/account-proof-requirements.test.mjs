import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getAccountProofRequirements,
  inspectAccountConfiguration,
} from '../packages/account/dist/preflight.js';
import {
  ACC_CAPABILITIES,
  inspectAccProofProfile,
} from '../packages/contract/dist/capabilities.js';
import { pureCircuits } from '../packages/contract/generated/acc-s3r1.1/index.js';
import { selectKeyProfile } from '../apps/passport-key-service/src/profiles.mjs';

const proofs = ACC_CAPABILITIES.circuits.filter((c) => c.kind === 'proof').map((c) => c.name);
const manifest = {
  bindingId: ACC_CAPABILITIES.binding.id,
  compilerManifestSha256: ACC_CAPABILITIES.binding.compilerManifestSha256,
};
const all = { name: 'all', circuits: proofs, verifierCircuits: proofs };
const profile = {
  ...selectKeyProfile('jubjub-owner-v1', new Map(proofs.map((name) => [`${name}.prover`, true]))),
  verifierCircuits: proofs,
};

for (const scheme of /** @type {const} */ (['p256-webauthn', 'jubjub-schnorr'])) {
  for (const operation of /** @type {const} */ ([
    'withdraw-unshielded',
    'withdraw-shielded',
    'issue-grant',
    'recover-pending-grants',
  ])) {
    test(`${scheme} ${operation} plans pinned circuits/helpers without executing them`, () => {
      for (const grantRead of [false, true]) {
        const plan = getAccountProofRequirements(scheme, { operation, grantRead });
        assert.equal(plan.bindingId, manifest.bindingId);
        assert.equal(plan.manifestSha256, manifest.compilerManifestSha256);
        assert.ok(
          Object.isFrozen(plan) &&
            Object.isFrozen(plan.proofCircuits) &&
            Object.isFrozen(plan.pureHelpers),
        );
        for (const name of plan.proofCircuits) assert.ok(proofs.includes(name), name);
        for (const name of plan.pureHelpers)
          assert.equal(typeof Reflect.get(pureCircuits, name), 'function', name);
        assert.equal(
          inspectAccProofProfile(all, manifest, plan.proofCircuits).status,
          'profile-covers-request',
        );
        const arm = scheme === 'p256-webauthn' ? 'p256' : 'jubjub';
        if (operation === 'recover-pending-grants')
          assert.deepEqual(plan.proofCircuits, [`append_inbox_with_${arm}`]);
        if (operation === 'issue-grant')
          assert.deepEqual(plan.proofCircuits, [
            `append_inbox_with_${arm}`,
            `issue_grant_with_${arm}`,
            ...(grantRead ? [`rotate_enc_key_with_${arm}`] : []),
          ]);
      }
    });
  }
}

test('the real ten-circuit key profile supports grant issue/publication but not owner withdrawals', () => {
  for (const grantRead of [false, true])
    assert.equal(
      inspectAccProofProfile(
        profile,
        manifest,
        getAccountProofRequirements('jubjub-schnorr', { operation: 'issue-grant', grantRead })
          .proofCircuits,
      ).status,
      'profile-covers-request',
    );
  for (const operation of /** @type {const} */ (['withdraw-unshielded', 'withdraw-shielded'])) {
    const report = inspectAccProofProfile(
      profile,
      manifest,
      getAccountProofRequirements('jubjub-schnorr', { operation }).proofCircuits,
    );
    assert.equal(report.status, 'profile-incomplete');
    assert.equal(report.issues[0]?.code, 'MissingProver');
    assert.equal(
      report.issues.some((x) => x.code === 'MissingVerifier'),
      false,
    );
  }
});

test('proof planning refuses unsupported arms/operations and absent grant read choice', () => {
  assert.throws(
    () => getAccountProofRequirements('jubjub-schnorr', { operation: 'issue-grant' }),
    RangeError,
  );
  assert.throws(
    () =>
      getAccountProofRequirements(/** @type {any} */ ('k256-ecdsa'), {
        operation: 'withdraw-unshielded',
      }),
    RangeError,
  );
  assert.throws(
    () =>
      getAccountProofRequirements(
        'jubjub-schnorr',
        /** @type {any} */ ({ operation: 'create-account' }),
      ),
    RangeError,
  );
});

test('materialized binding helper gaps are reported without invoking any helper or loader', () => {
  const ports = { authoriser: { scheme: 'p256-webauthn' }, binding: { pureCircuits: {} } };
  const report = inspectAccountConfiguration(ports, { operation: 'withdraw-unshielded' });
  assert.ok(
    report.issues.some(
      (x) => x.path === 'binding.pureCircuits.challenge_withdraw_unshielded_with_p256',
    ),
  );
  const present = inspectAccountConfiguration(
    { ...ports, binding: { pureCircuits } },
    { operation: 'withdraw-unshielded' },
  );
  assert.equal(
    present.issues.some((x) => x.path.startsWith('binding.')),
    false,
  );
});
