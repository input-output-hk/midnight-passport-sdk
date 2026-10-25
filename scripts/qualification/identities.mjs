// Synthetic identities only. Never use this module as a passkey/provider implementation.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  fakeAuthoriser,
  fakeCredentials,
  FAKE_POLICY,
  signP256,
} from '../../packages/account/dist/testing/index.js';
import {
  deriveSymmetricSecret,
  recipeDeviceKeyring,
  recipeJubjubAuthoriser,
} from '../../packages/keys/dist/index.js';
import { pureCircuits } from '../../packages/contract/generated/acc-s3r1.1/index.js';

/** @typedef {{seed:Uint8Array, device:Uint8Array, credential:Uint8Array, signing:{x:bigint,y:bigint,d:bigint}}} SoftwareIdentity */
/** Generate once, persist privately before enrollment, and reuse after every restart. */
export async function createSoftwareIdentity() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const key = await crypto.subtle.exportKey('jwk', pair.privateKey);
  /** @param {string|undefined} value */
  const integer = (value) => {
    assert.equal(typeof value, 'string');
    return BigInt('0x' + Buffer.from(/** @type {string} */ (value), 'base64url').toString('hex'));
  };
  return {
    seed: new Uint8Array(randomBytes(32)),
    device: new Uint8Array(randomBytes(32)),
    credential: new Uint8Array(randomBytes(16)),
    signing: { x: integer(key.x), y: integer(key.y), d: integer(key.d) },
  };
}
/** @template T @param {()=>Promise<T>} work */
const session = async (work) => work();
/** @param {SoftwareIdentity} material @param {'p256'|'jubjub'} arm */
export function softwareParticipant(material, arm) {
  const source = {
    withSession: session,
    deviceSecret: async () => material.device.slice(),
    /** @param {Parameters<typeof deriveSymmetricSecret>[1]} p */
    deriveSecret: async (p) => deriveSymmetricSecret(material.seed, p),
  };
  const fallback = fakeAuthoriser({ credentialId: material.credential });
  const authoriser =
    arm === 'p256'
      ? {
          ...fallback,
          withKeySession: session,
          devicePublicKey: async () => ({ x: material.signing.x, y: material.signing.y }),
          devicePublicKeyHex: async () =>
            (material.signing.y & 1n ? '03' : '02') +
            material.signing.x.toString(16).padStart(64, '0'),
          /** @param {Parameters<typeof fallback.authorise>[0]} input */
          authorise: async (input) => {
            if (input.credentialId && !Buffer.from(input.credentialId).equals(material.credential))
              throw Object.assign(
                new Error('Synthetic identity was pinned to another credential.'),
                { code: 'WrongPasskey' },
              );
            assert.ok(input.challenge instanceof Uint8Array);
            assert.equal(input.challenge.length, 32);
            return {
              scheme: /** @type {const} */ ('p256-webauthn'),
              pk: { x: material.signing.x, y: material.signing.y },
              useCounter: input.useCounter,
              ...(await signP256(material.signing, input.challenge, FAKE_POLICY)),
            };
          },
        }
      : recipeJubjubAuthoriser(source, pureCircuits);
  const keyring = recipeDeviceKeyring(source);
  const credentialPort = fakeCredentials({ authoriser });
  const credentials = {
    /** @param {Parameters<typeof credentialPort.create>[0]} input */
    create: async (input) => ({
      ...(await credentialPort.create(input)),
      credentialId: material.credential.slice(),
    }),
    identify: async () => ({
      ...(await credentialPort.identify()),
      credentialId: material.credential.slice(),
    }),
  };
  return {
    source,
    authoriser,
    credentials,
    keyring,
    reader: async () => ({
      readerPublicKey: Buffer.from(await keyring.readerPublicKey('undeployed')).toString('hex'),
      devicePublicKey: await authoriser.devicePublicKeyHex(),
      ...(arm === 'p256' && {
        scheme: /** @type {const} */ ('p256-webauthn'),
        policy: FAKE_POLICY,
      }),
    }),
  };
}
