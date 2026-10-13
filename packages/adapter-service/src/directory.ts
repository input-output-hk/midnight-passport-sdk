import { PassportConnectorError } from '@midnight-ntwrk/mn-passport-account/errors';
import type {
  AccountDirectory,
  AccountHint,
  OwnershipProof,
} from '@midnight-ntwrk/mn-passport-account/ports';
import type { ServiceWire as Wire } from '@midnight-ntwrk/mn-passport-protocol';
import { fromHex, toHex } from './hex.js';
import type { RemoteOptions } from './options.js';
import { defaultFetch, trimBase } from './service-client.js';

const hexBigint = (value: bigint): string => value.toString(16);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function toWire(hint: AccountHint): Wire.AccountHintBody {
  return {
    address: hint.address,
    scheme: hint.scheme,
    ...(hint.credentialId && { credentialId: toHex(hint.credentialId) }),
    publicKey: { x: hexBigint(hint.publicKey.x), y: hexBigint(hint.publicKey.y) },
    ...(hint.policy && {
      policy: { rp_id_hash: toHex(hint.policy.rp_id_hash), origin: toHex(hint.policy.origin) },
    }),
    ...(hint.salt && { salt: toHex(hint.salt) }),
    status: hint.status,
  };
}

function proofToWire(proof: OwnershipProof): Wire.OwnershipProofBody {
  if (proof.scheme === 'p256-webauthn') {
    return {
      scheme: proof.scheme,
      challenge: toHex(proof.challenge),
      authenticatorData: toHex(proof.authenticatorData),
      clientDataJSON: toHex(proof.clientDataJSON),
      signature: toHex(proof.signature),
    };
  }
  return {
    scheme: proof.scheme,
    challenge: toHex(proof.challenge),
    sigR: { x: hexBigint(proof.sigR.x), y: hexBigint(proof.sigR.y) },
    sigS: hexBigint(proof.sigS),
  };
}

/** Parse untrusted directory JSON before the account core verifies it against the ledger. */
function fromWire(value: unknown): AccountHint {
  if (!record(value) || !record(value.publicKey)) throw new Error('invalid directory hint');
  const { address, scheme, credentialId, publicKey, policy, salt, status } = value;
  if (
    typeof address !== 'string' ||
    !address ||
    !['p256-webauthn', 'jubjub-schnorr', 'k256-ecdsa'].includes(String(scheme)) ||
    typeof publicKey.x !== 'string' ||
    typeof publicKey.y !== 'string' ||
    !/^[0-9a-f]+$/i.test(publicKey.x) ||
    !/^[0-9a-f]+$/i.test(publicKey.y) ||
    !['deployed', 'active'].includes(String(status)) ||
    (credentialId !== undefined && typeof credentialId !== 'string') ||
    (salt !== undefined && typeof salt !== 'string') ||
    (policy !== undefined &&
      (!record(policy) ||
        typeof policy.rp_id_hash !== 'string' ||
        typeof policy.origin !== 'string'))
  ) {
    throw new Error('invalid directory hint');
  }
  return {
    address,
    scheme: scheme as AccountHint['scheme'],
    publicKey: { x: BigInt(`0x${publicKey.x}`), y: BigInt(`0x${publicKey.y}`) },
    ...(credentialId !== undefined && { credentialId: fromHex(credentialId) }),
    ...(salt !== undefined && { salt: fromHex(salt) }),
    ...(policy !== undefined &&
      record(policy) && {
        policy: {
          rp_id_hash: fromHex(String(policy.rp_id_hash)),
          origin: fromHex(String(policy.origin)),
        },
      }),
    status: status as AccountHint['status'],
  };
}

/** The versioned service directory; its answers are hints that the core checks on chain. */
export function remoteDirectory(base: string, options: RemoteOptions = {}): AccountDirectory {
  const fetchFn = options.fetch ?? defaultFetch;
  const url = (networkId: string, credentialId: Uint8Array) =>
    `${trimBase(base)}/v1/accounts/${encodeURIComponent(networkId)}/${toHex(credentialId)}`;
  return {
    async get(networkId, key) {
      let response;
      try {
        response = await fetchFn(url(networkId, key.credentialId));
      } catch (cause) {
        throw new PassportConnectorError('InternalError', 'directory GET is unreachable', {
          cause,
        });
      }
      if (response.status === 404) return undefined;
      if (!response.ok)
        throw new PassportConnectorError(
          'InternalError',
          `directory GET failed: HTTP ${response.status}`,
        );
      try {
        return fromWire(await response.json());
      } catch (cause) {
        throw new PassportConnectorError(
          'InternalError',
          'directory GET answered an invalid hint',
          {
            cause,
          },
        );
      }
    },
    async put(networkId, hint, proof) {
      if (!hint.credentialId)
        throw new PassportConnectorError('InternalError', 'directory hint has no credential id');
      const body: Wire.DirectoryPutRequest = {
        hint: toWire(hint),
        ...(proof && { proof: proofToWire(proof) }),
      };
      let response;
      try {
        response = await fetchFn(url(networkId, hint.credentialId), {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (cause) {
        throw new PassportConnectorError('InternalError', 'directory PUT is unreachable', {
          cause,
        });
      }
      if (!response.ok)
        throw new PassportConnectorError(
          'InternalError',
          `directory PUT failed: HTTP ${response.status}`,
        );
    },
  };
}
