// Generated ACC validates actual JubJub signatures and key recipes; no native acceptance claim.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publishJubjubGrantBookkeeping } from '../packages/account/dist/index.js';
import { jubjubPublicationFixture } from './fixtures/jubjub-publication-fixture.mjs';

test('the read-seal Flow observer can replace the current host method with its receiver', async () => {
  const f = await jubjubPublicationFixture(true);
  const seal = f.viewingKey.sealView;
  assert.ok(seal);
  let replaced = 0;
  await publishJubjubGrantBookkeeping(
    {
      ...f.input,
      onEvent(event) {
        f.input.onEvent(event);
        if (event.step === 'grant.seal' && event.phase === 'start')
          f.viewingKey.sealView = async function (...args) {
            assert.equal(this, f.viewingKey);
            replaced++;
            return seal.apply(this, args);
          };
      },
    },
    f.ports,
  );
  assert.equal(replaced, 1);
  assert.equal(f.marked(), true);
});

test('a custom decoder retains the legacy late array-entry lookup before publication', async () => {
  const f = await jubjubPublicationFixture();
  const seal = f.viewingKey.sealGrant;
  const open = f.viewingKey.openInbox;
  /** @type {Uint8Array[] | undefined} */ let sealed;
  /** @type {Uint8Array | undefined} */ let replacement;
  f.viewingKey.sealGrant = async function (...args) {
    sealed = await seal.apply(this, args);
    return sealed;
  };
  f.viewingKey.openInbox = async function (...args) {
    const result = await open.apply(this, args);
    if (args[2] === sealed) {
      const header = sealed?.[0];
      assert.ok(header);
      replacement = Uint8Array.from(header);
      // Deliberately breaks readonly provider output to protect the pre-extraction lookup time.
      Reflect.set(sealed, 0, replacement);
    }
    return result;
  };
  await publishJubjubGrantBookkeeping(f.input, f.ports);
  assert.ok(replacement);
  assert.equal(f.calls[0]?.args[0], replacement);
  assert.equal(f.marked(), true);
});

test('read delivery rereads the provider entry after the counter observer before signing and sending', async () => {
  const f = await jubjubPublicationFixture(true);
  const seal = f.viewingKey.sealView;
  assert.ok(seal);
  /** @type {Awaited<ReturnType<typeof seal>> | undefined} */ let delivery;
  /** @type {Uint8Array | undefined} */ let replacement;
  f.viewingKey.sealView = async function (...args) {
    delivery = await seal.apply(this, args);
    return delivery;
  };
  await publishJubjubGrantBookkeeping(
    {
      ...f.input,
      onEvent(event) {
        f.input.onEvent(event);
        if (event.step === 'counter.scan' && event.phase === 'start' && f.signatures.length === 2) {
          assert.ok(delivery);
          replacement = Uint8Array.from(delivery.entry);
          // A custom provider can replace its readonly result; preserve the existing observation point.
          Object.assign(delivery, { entry: replacement });
        }
      },
    },
    f.ports,
  );
  assert.ok(replacement);
  assert.equal(f.signatures[2]?.args[0], replacement);
  assert.equal(f.calls[2]?.args[0], replacement);
  assert.equal(f.marked(), true);
});
