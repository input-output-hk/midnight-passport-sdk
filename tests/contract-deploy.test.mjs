// The release binding's constructor ABI and generated-module shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  AccModuleShapeError,
  BINDING_VERSION,
  UnsupportedBindingError,
  assertBindingCompatible,
  bindAccModule,
  buildDeployArgs,
  resolveBinding,
} = await import(new URL('../packages/contract/dist/index.js', import.meta.url).href);

test('new deployments select the pinned grants binding', () => {
  assert.equal(BINDING_VERSION, 'acc-s3r1.1');
  assert.doesNotThrow(() => assertBindingCompatible(BINDING_VERSION));
  assert.throws(() => assertBindingCompatible('0.0.0-prototype.1'), UnsupportedBindingError);
});

test('buildDeployArgs follows the five-argument acc-s3r1.1 constructor', () => {
  const boot = new Uint8Array(32).fill(1);
  const key = new Uint8Array(32).fill(2);
  const recoveryPk = { x: 3n, y: 4n };
  const wrap = new Uint8Array(64).fill(5);
  const args = buildDeployArgs({
    initialDeviceBoot: boot,
    encryptionKey: key,
    initialRecoveryPk: recoveryPk,
    initialRecoveryWrap: wrap,
    vetoWindowSeconds: 3n * 24n * 3600n,
  });
  assert.equal(args.bindingVersion, BINDING_VERSION);
  assert.deepEqual(args.constructorArgs, [boot, key, recoveryPk, wrap, 259200n]);
  assert.throws(
    () =>
      buildDeployArgs(
        {
          initialDeviceBoot: boot,
          encryptionKey: key,
          initialRecoveryPk: recoveryPk,
          initialRecoveryWrap: wrap,
          vetoWindowSeconds: 259200n,
        },
        '0.0.0-prototype.1',
      ),
    UnsupportedBindingError,
  );
});

test('bindAccModule rejects incomplete modules', () => {
  for (const candidate of [null, {}, { Contract: class {}, ledger: () => ({}) }]) {
    assert.throws(() => bindAccModule(candidate), AccModuleShapeError);
  }
  assert.throws(
    () => bindAccModule({ Contract: class {}, ledger: () => ({}), pureCircuits: {} }),
    AccModuleShapeError,
  );
});

test('bindAccModule accepts and freezes the packaged grants generated module', async () => {
  const generated = await import(
    new URL('../packages/contract/generated/acc-s3r1.1/index.js', import.meta.url).href
  );
  const acc = bindAccModule(generated);
  assert.equal(acc.Contract, generated.Contract);
  assert.equal(acc.ledger, generated.ledger);
  assert.ok(Object.isFrozen(acc));
  assert.ok(Object.isFrozen(acc.pureCircuits));
  assert.equal(Object.keys(acc.pureCircuits).length, 66);
  assert.equal(typeof acc.pureCircuits.derive_boot_commitment_with_p256, 'function');
  assert.equal(typeof acc.pureCircuits.challenge_rotate_enc_key_with_p256, 'function');
});

test("the dev runtime pin equals the grants binding's runtime", () => {
  const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(
    root.devDependencies['@midnight-ntwrk/compact-runtime'],
    resolveBinding(BINDING_VERSION).toolchain.runtimeVersion,
  );
});
