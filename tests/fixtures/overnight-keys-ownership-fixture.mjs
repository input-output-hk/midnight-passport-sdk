import assert from 'node:assert/strict';
import { x25519 } from '@noble/curves/ed25519.js';
import { jubjub } from '@noble/curves/misc.js';
import { recipeDeviceKeyring } from '../../packages/keys/dist/index.js';
import { openDeviceEnvelope } from '../../packages/keys/dist/device-envelope.js';

/** @param {Uint8Array} bytes */
export const hex = (bytes) => Buffer.from(bytes).toString('hex');
export const account = 'ab'.repeat(32);
export const devicePublicKey = hex(jubjub.Point.BASE.toBytes());
/** @param {number} value */
export const reader = (value) => ({
  readerPublicKey: hex(x25519.getPublicKey(new Uint8Array(32).fill(value))),
  devicePublicKey: hex(jubjub.Point.BASE.multiply(BigInt(value)).toBytes()),
  epoch: 0n,
  counter: 0n,
});
export function controlledSource() {
  /** @type {Promise<void> | undefined} */
  let gate;
  /** @type {() => void} */
  let resume = () => {};
  /** @type {(() => void) | undefined} */
  let after;
  /** @type {Uint8Array[]} */
  const outputs = [];
  let sessions = 0;
  /** @type {import('../../packages/account/dist/ports/index.js').PrfKeySource} */
  const source = {
    async withSession(work) {
      sessions++;
      if (gate) await gate;
      const result = await work();
      after?.();
      return result;
    },
    async deriveSecret() {
      const raw = Buffer.alloc(32, 9);
      outputs.push(raw);
      return raw;
    },
    async deviceSecret() {
      throw new Error('unexpected owner secret request');
    },
  };
  return {
    source,
    outputs,
    sessions: () => sessions,
    pause() {
      gate = new Promise((resolve) => {
        resume = resolve;
      });
    },
    release() {
      gate = undefined;
      resume();
    },
    /** @param {(() => void) | undefined} callback */
    after(callback) {
      after = callback;
    },
  };
}
export async function keyringFixture() {
  const control = controlledSource();
  const owner = recipeDeviceKeyring(control.source);
  const created = await owner.createKeys('undeployed', { devicePublicKey });
  const encKey = Buffer.from(created.encKey);
  const envelopes = created.envelopes.map((entry) => Buffer.from(entry));
  const ring = { account, encKey, envelopes };
  const firstEnvelope = envelopes[0];
  assert.ok(firstEnvelope);
  const ownSecret = Buffer.alloc(32, 9);
  const secrets = await openDeviceEnvelope(ownSecret, firstEnvelope);
  ownSecret.fill(0);
  assert.ok(secrets);
  /** @type {Uint8Array[]} */
  const cleanup = [secrets.secret, secrets.rosterKey];
  return {
    owner,
    ring,
    secrets,
    control,
    /** @param {number} length @param {number} value */
    bytes(length, value) {
      const bytes = Buffer.alloc(length, value);
      cleanup.push(bytes);
      return bytes;
    },
    close() {
      control.release();
      assert.ok(
        control.outputs.every((bytes) => bytes.every((value) => value === 0)),
        'provider-owned secret outputs are erased',
      );
      for (const bytes of cleanup) bytes.fill(0);
    },
  };
}
export const pins = {
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
  scheme: /** @type {'jubjub-schnorr'} */ ('jubjub-schnorr'),
};
export const mutationId = '12'.repeat(16);
export const mutationDocument = () => ({
  version: /** @type {1} */ (1),
  id: mutationId,
  revision: 0,
  pins: { ...pins },
  intent: {
    kind: /** @type {'create'} */ ('create'),
    userName: 'offline-synthetic',
    retireAuthority: true,
  },
  randomSeed: Buffer.alloc(32, 99),
  phase: /** @type {'pending'} */ ('pending'),
  entries: [],
});
export function memoryStore() {
  /** @type {{ revision: number; bytes: Uint8Array } | undefined} */
  let saved;
  /** @type {import('../../packages/account/dist/ports/index.js').MutationByteStore} */
  const store = {
    async read() {
      return saved;
    },
    async compareAndSwap(_id, expected, next) {
      assert.equal(next.revision, expected === undefined ? 0 : expected + 1);
      if (saved?.revision !== expected) return false;
      saved = { revision: next.revision, bytes: Buffer.from(next.bytes) };
      return true;
    },
  };
  return {
    store,
    saved: () => saved,
    close() {
      saved?.bytes.fill(0);
    },
  };
}
