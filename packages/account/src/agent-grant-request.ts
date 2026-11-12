import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import {
  compactJubjubOrder,
  compactJubjubPoint,
  compactLittleEndian,
  verifyCompactJubjub,
} from './compact-jubjub.js';
import { PassportConnectorError } from './errors.js';
import {
  chainReference,
  decodeGrantJson,
  grantRequestDigest,
  grantWireHex32,
  grantWireUint128,
  maxGrantParameterLength,
  timestamp,
} from './grant-request-wire.js';

const canonicalUrl = z.url({ normalize: true });
const affine = z
  .string()
  .length(128)
  .regex(/^[0-9a-f]+$/);
const bounds = z.strictObject({
  color: grantWireHex32,
  per_call_cap: grantWireUint128,
  cap: grantWireUint128,
  max_coin_value: grantWireUint128,
  expires_at: timestamp,
  recipient: z.strictObject({ kind: z.literal('user'), value: grantWireHex32 }),
});
const requestSchema = z.strictObject({
  v: z.literal(1),
  chain: chainReference,
  aud: z.string().max(256),
  iat: timestamp,
  exp: timestamp,
  client_id: z.string().min(1).max(258),
  account: grantWireHex32.optional(),
  grantee: z.strictObject({ scheme: z.literal('schnorr_jubjub'), pk: affine }),
  grants: z.tuple([
    z.strictObject({
      slot: z.number().int().min(0).max(255),
      scope: z.tuple([z.literal('midnight:account:withdraw_unshielded')]),
      bounds,
    }),
  ]),
  nonce: grantWireHex32,
});
const signature = z.strictObject({
  type: z.literal('signature'),
  key_signature: z
    .string()
    .length(192)
    .regex(/^[0-9a-f]+$/),
});
const parameters = z.strictObject({
  request: z.string().min(1).max(maxGrantParameterLength),
  proof: z.string().min(1).max(maxGrantParameterLength),
});

function invalid(): never {
  throw new PassportConnectorError(
    'GrantScopeInvalid',
    'Invalid or unsupported agent grant request.',
  );
}

function readPoint(bytes: Uint8Array) {
  return compactJubjubPoint({
    x: compactLittleEndian(bytes.subarray(0, 32)),
    y: compactLittleEndian(bytes.subarray(32, 64)),
  });
}

function verifyProof(encodedKey: string, encodedSignature: string, digest: Uint8Array) {
  const key = hexToBytes(encodedKey);
  const wire = hexToBytes(encodedSignature);
  const commitment = wire.subarray(0, 64);
  const point = readPoint(key);
  const nonce = readPoint(commitment);
  const scalar = compactLittleEndian(wire.subarray(64));
  const challenge =
    compactLittleEndian(sha256(concatBytes(commitment, key, digest))) % compactJubjubOrder;
  if (!verifyCompactJubjub(point, nonce, scalar, challenge)) return invalid();
  return bytesToHex(point.toBytes());
}

function identity(clientId: string): 'operator-asserted' | 'owner-label' {
  const separator = clientId.indexOf(':');
  const kind = clientId.slice(0, separator);
  const value = clientId.slice(separator + 1);
  const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  const labels = value.split('.');
  if (
    kind === 'rdns' &&
    value.length <= 253 &&
    labels.length >= 2 &&
    !/[^a-z0-9.-]/.test(value) &&
    labels.every((part) => label.test(part))
  )
    return 'operator-asserted';
  if (kind === 'mais' && value.length >= 1 && value.length <= 128 && !/[^a-z0-9._~-]/.test(value))
    return 'operator-asserted';
  if (kind === 'self' && value.length >= 1 && value.length <= 64 && !/[^a-z0-9_-]/.test(value))
    return 'owner-label';
  return invalid();
}

export interface AgentJubjubGrantRequestContext {
  readonly authoriserOrigin: string;
  readonly networkId: string;
  readonly account: string;
  readonly nowSeconds: number;
}

/**
 * Verify a key-only grant request received through the host's non-browser binding.
 * The caller must establish transport provenance, obtain owner consent and durably
 * admit the nonce before issuing anything. Client labels convey no verified origin.
 */
export function verifyAgentJubjubGrantRequest(
  input: unknown,
  context: AgentJubjubGrantRequestContext,
) {
  try {
    const { request, proof } = parameters.parse(input);
    const digest = grantRequestDigest(request);
    const signed = requestSchema.parse(decodeGrantJson(request));
    const { key_signature: proofBytes } = signature.parse(decodeGrantJson(proof));
    const issuer = context.authoriserOrigin;
    const account = grantWireHex32.parse(context.account);
    const networkId = chainReference.parse(context.networkId).replace(/^midnight:/, '');
    const now = timestamp.parse(context.nowSeconds);
    const [{ slot, bounds }] = signed.grants;
    const {
      per_call_cap: perCall,
      cap,
      max_coin_value: maxCoinValue,
      expires_at: expiresAt,
    } = bounds;
    if (
      !issuer.startsWith('https://') ||
      /[@\\\s]/.test(issuer) ||
      canonicalUrl.parse(issuer) !== issuer + '/' ||
      signed.aud !== issuer ||
      signed.chain.replace(/^midnight:/, '') !== networkId ||
      (signed.account !== undefined && signed.account !== account) ||
      signed.iat > now ||
      signed.exp < now ||
      signed.exp - signed.iat > 600 ||
      expiresAt <= now ||
      BigInt(perCall) === 0n ||
      BigInt(perCall) > BigInt(cap) ||
      BigInt(perCall) > BigInt(maxCoinValue) ||
      /^0+$/.test(bounds.recipient.value)
    )
      return invalid();
    return Object.freeze({
      account,
      accountSource:
        signed.account === undefined ? ('owner-selected' as const) : ('signed-request' as const),
      issuer,
      networkId,
      slot,
      clientId: signed.client_id,
      identity: identity(signed.client_id),
      requestDigest: bytesToHex(digest),
      nonce: signed.nonce,
      validUntilSeconds: signed.exp,
      scope: Object.freeze({
        grantee: Object.freeze({
          scheme: 'jubjub-schnorr' as const,
          publicKey: verifyProof(signed.grantee.pk, proofBytes, digest),
        }),
        operations: Object.freeze(['withdraw-unshielded'] as const),
        color: bounds.color,
        recipient: Object.freeze({ kind: 'user-address' as const, value: bounds.recipient.value }),
        perCallCap: perCall,
        cap,
        maxCoinValue,
        expiresAt,
      }),
    });
  } catch {
    return invalid();
  }
}
