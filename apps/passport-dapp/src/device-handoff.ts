import { webauthnPasskey, webauthnPolicy } from '@input-output-hk/mn-passport-adapter-webauthn';
import {
  recipeDeviceKeyring,
  recipeJubjubAuthoriser,
  type JubjubDeviceCircuits,
} from '@input-output-hk/mn-passport-keys';
import type { PassportDeviceReader } from '@input-output-hk/mn-passport-protocol';
import { accModule } from './acc-module.js';

const ADDRESS = /^[0-9a-f]{64}$/;
const READER = /^[0-9a-f]{64}$/;
const P256_KEY = /^(02|03)[0-9a-f]{64}$/;
const JUBJUB_KEY = /^[0-9a-f]{64}$/;
const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const bytes = (value: string): Uint8Array =>
  Uint8Array.from(value.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
const same = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index]);

interface WireHandoff {
  readonly kind: 'mn-passport-device-handoff-v1';
  readonly accountAddress: string;
  readonly networkId: string;
  readonly bindingId: string;
  readonly readerPublicKey: string;
  readonly devicePublicKey: string;
  readonly scheme: 'p256-webauthn' | 'jubjub-schnorr';
  readonly policy?: { readonly rpIdHash: string; readonly origin: string };
  readonly fingerprint: string;
}

const canonical = (handoff: Omit<WireHandoff, 'fingerprint'>): string =>
  JSON.stringify({
    kind: handoff.kind,
    accountAddress: handoff.accountAddress,
    networkId: handoff.networkId,
    bindingId: handoff.bindingId,
    readerPublicKey: handoff.readerPublicKey,
    devicePublicKey: handoff.devicePublicKey,
    scheme: handoff.scheme,
    ...(handoff.policy && { policy: handoff.policy }),
  });

async function fingerprint(handoff: Omit<WireHandoff, 'fingerprint'>): Promise<string> {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(handoff))),
    ),
  );
}

/** Creates a new passkey on the joining browser and exports only its public reader metadata. */
export async function prepareDeviceHandoff(
  accountAddress: string,
  networkId: string,
  arm: 'p256' | 'jubjub',
  options: { bindingId: string; rpId: string; origin: string; credentials?: CredentialsContainer },
): Promise<WireHandoff> {
  if (!ADDRESS.test(accountAddress)) throw new Error('Enter the target ACC address first.');
  const passkey = webauthnPasskey({
    rpId: options.rpId,
    origin: options.origin,
    ...(options.credentials && { credentials: options.credentials }),
  });
  await passkey.credentials.create({ name: 'Midnight Passport joining device' });
  const keyring = recipeDeviceKeyring(passkey.prf);
  const publicKeys = await passkey.prf.withSession(async () => {
    const readerPublicKey = hex(await keyring.readerPublicKey(networkId));
    if (arm === 'p256') {
      const binding = await passkey.p256.deviceBinding!();
      return {
        readerPublicKey,
        devicePublicKey: await passkey.p256.devicePublicKeyHex!(),
        scheme: 'p256-webauthn' as const,
        policy: {
          rpIdHash: hex(binding.policy.rp_id_hash),
          origin: hex(binding.policy.origin),
        },
      };
    }
    const pure = accModule.pureCircuits;
    if (
      typeof pure.compute_public_point_with_jubjub !== 'function' ||
      typeof pure.derive_device_entry_with_jubjub !== 'function'
    )
      throw new Error('The pinned ACC binding cannot prepare a JubJub joining device.');
    const authoriser = recipeJubjubAuthoriser(passkey.prf, pure as JubjubDeviceCircuits);
    return {
      readerPublicKey,
      devicePublicKey: await authoriser.devicePublicKeyHex(),
      scheme: 'jubjub-schnorr' as const,
    };
  });
  const publicPart = {
    kind: 'mn-passport-device-handoff-v1' as const,
    accountAddress,
    networkId,
    bindingId: options.bindingId,
    ...publicKeys,
  };
  return { ...publicPart, fingerprint: await fingerprint(publicPart) };
}

/** Refuse a changed, cross-network or cross-origin handoff before the owner signs. */
export async function parseDeviceHandoff(
  text: string,
  expected: {
    accountAddress: string;
    networkId: string;
    bindingId: string;
    rpId: string;
    origin: string;
    arm: 'p256' | 'jubjub';
  },
): Promise<{ handoff: WireHandoff; reader: PassportDeviceReader }> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('The joining-device JSON is invalid.');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('The joining-device JSON is invalid.');
  const value = raw as Record<string, unknown>;
  const allowed = new Set([
    'kind',
    'accountAddress',
    'networkId',
    'bindingId',
    'readerPublicKey',
    'devicePublicKey',
    'scheme',
    'policy',
    'fingerprint',
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key)))
    throw new Error('The handoff contains an unexpected field.');
  if (
    value.kind !== 'mn-passport-device-handoff-v1' ||
    value.accountAddress !== expected.accountAddress ||
    value.networkId !== expected.networkId ||
    value.bindingId !== expected.bindingId ||
    value.scheme !== (expected.arm === 'p256' ? 'p256-webauthn' : 'jubjub-schnorr') ||
    typeof value.readerPublicKey !== 'string' ||
    !READER.test(value.readerPublicKey) ||
    typeof value.devicePublicKey !== 'string' ||
    !(expected.arm === 'p256' ? P256_KEY : JUBJUB_KEY).test(value.devicePublicKey) ||
    typeof value.fingerprint !== 'string' ||
    !READER.test(value.fingerprint)
  )
    throw new Error('The handoff does not match this ACC, network, binding or authoriser arm.');
  const policy = value.policy;
  if (expected.arm === 'p256') {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy))
      throw new Error('The joining WebAuthn policy is missing.');
    const got = policy as Record<string, unknown>;
    if (Object.keys(got).some((key) => key !== 'rpIdHash' && key !== 'origin'))
      throw new Error('The joining WebAuthn policy contains an unexpected field.');
    const expectedPolicy = webauthnPolicy(expected.rpId, expected.origin);
    if (
      typeof got.rpIdHash !== 'string' ||
      !READER.test(got.rpIdHash) ||
      typeof got.origin !== 'string' ||
      !/^[0-9a-f]{42}$/.test(got.origin) ||
      !same(bytes(got.rpIdHash), expectedPolicy.rp_id_hash) ||
      !same(bytes(got.origin), expectedPolicy.origin)
    )
      throw new Error('The joining WebAuthn policy has a different origin or RP ID.');
  } else if (policy !== undefined) {
    throw new Error('A JubJub handoff cannot carry a WebAuthn policy.');
  }
  const publicPart = {
    kind: value.kind,
    accountAddress: value.accountAddress,
    networkId: value.networkId,
    bindingId: value.bindingId,
    readerPublicKey: value.readerPublicKey,
    devicePublicKey: value.devicePublicKey,
    scheme: value.scheme,
    ...(expected.arm === 'p256' && { policy: policy as WireHandoff['policy'] }),
  } as Omit<WireHandoff, 'fingerprint'>;
  if ((await fingerprint(publicPart)) !== value.fingerprint)
    throw new Error('The handoff fingerprint does not match its public keys.');
  const handoff: WireHandoff = { ...publicPart, fingerprint: value.fingerprint };
  const reader: PassportDeviceReader =
    expected.arm === 'p256'
      ? {
          scheme: 'p256-webauthn',
          readerPublicKey: handoff.readerPublicKey,
          devicePublicKey: handoff.devicePublicKey,
          policy: {
            rp_id_hash: bytes(handoff.policy!.rpIdHash),
            origin: bytes(handoff.policy!.origin),
          },
        }
      : {
          readerPublicKey: handoff.readerPublicKey,
          devicePublicKey: handoff.devicePublicKey,
        };
  return { handoff, reader };
}
