import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type {
  AccountDirectory,
  AccountHint,
  OwnershipProof,
} from '@input-output-hk/mn-passport-account/ports';
import type { ServiceWire as Wire } from '@input-output-hk/mn-passport-protocol';
import { toHex } from './hex.js';
import { boundedJson } from './bounded-json.js';
import { directoryHint } from './directory-codec.js';
import type { RemoteOptions } from './options.js';
import { defaultFetch, trimBase } from './service-client.js';

const hexBigint = (value: bigint): string => value.toString(16);

function toWire(hint: AccountHint): Wire.AccountHintBody {
  if (
    hint.keyEntries &&
    (hint.keyEntries.length > 16 || hint.keyEntries.some((entry) => entry.length !== 192))
  )
    throw new PassportConnectorError('InternalError', 'directory key entries must be 192 bytes');
  return {
    address: hint.address,
    scheme: hint.scheme,
    ...(hint.credentialId && { credentialId: toHex(hint.credentialId) }),
    publicKey: { x: hexBigint(hint.publicKey.x), y: hexBigint(hint.publicKey.y) },
    ...(hint.policy && {
      policy: { rp_id_hash: toHex(hint.policy.rp_id_hash), origin: toHex(hint.policy.origin) },
    }),
    ...(hint.salt && { salt: toHex(hint.salt) }),
    ...(hint.keyEntries && { keyEntries: hint.keyEntries.map(toHex) }),
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

/** The versioned service directory; its answers are hints that the core checks on chain. */
export function remoteDirectory(base: string, options: RemoteOptions = {}): AccountDirectory {
  const fetchFn = options.fetch ?? defaultFetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000)
    throw new PassportConnectorError('InternalError', 'Invalid directory read timeout.');
  const url = (networkId: string, credentialId: Uint8Array) =>
    `${trimBase(base)}/v1/accounts/${encodeURIComponent(networkId)}/${toHex(credentialId)}`;
  return {
    async get(networkId, key) {
      let response;
      try {
        response = await fetchFn(url(networkId, key.credentialId), {
          signal: AbortSignal.timeout(timeoutMs),
        });
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
        return directoryHint(await boundedJson(response, 32_768));
      } catch {
        throw new PassportConnectorError('InternalError', 'directory GET answered an invalid hint');
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
