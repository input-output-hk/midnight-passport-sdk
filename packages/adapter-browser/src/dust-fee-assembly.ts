import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import { resolveBinding } from '@input-output-hk/mn-passport-contract';
import {
  ContractCall,
  Transaction,
  type PreBinding,
  type Proof,
  type SignatureEnabled,
} from '@midnightntwrk/ledger-v9';
import { z } from 'zod';

const hex32 = z.string().regex(/^[0-9a-f]{64}$/);
const maximumBytes = 8 * 1024 * 1024;
const bytes = z
  .custom<Uint8Array>((value) => value instanceof Uint8Array)
  .refine((value) => value.buffer instanceof ArrayBuffer)
  .refine((value) => value.byteLength > 0 && value.byteLength <= maximumBytes);
const request = z.strictObject({
  provedAccount: bytes,
  provedFee: bytes,
  networkId: z.string().regex(/^[a-z0-9-]{1,64}$/),
  bindingId: z.string().regex(/^[a-z0-9.-]{1,128}$/),
  address: hex32,
  circuit: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,127}$/),
  accountSha256: hex32,
  maxDust: z
    .bigint()
    .positive()
    .max(2n ** 128n - 1n),
  feeExpiresByMs: z.number().int().positive().max(8_640_000_000_000_000),
});

export type DustFeeAssemblyInput = z.input<typeof request>;
type Proved = Transaction<SignatureEnabled, Proof, PreBinding>;

function singleIntent(tx: Proved, networkId: string, now: number) {
  // Use Ledger's network equality check without modifying the submitted bytes.
  tx.eraseProofs().merge(Transaction.fromParts(networkId).eraseProofs());
  if (tx.rewards || tx.guaranteedOffer || tx.fallibleOffer?.size || tx.intents?.size !== 1)
    throw new Error('Expected one intent without asset offers or rewards.');
  const [entry] = tx.intents;
  if (!entry) throw new Error('Missing intent.');
  const [segment, intent] = entry;
  if (
    intent.guaranteedUnshieldedOffer ||
    intent.fallibleUnshieldedOffer ||
    !(intent.ttl.getTime() > now)
  )
    throw new Error('Invalid or expired intent.');
  for (const part of new Set([0, segment])) {
    for (const [token, value] of tx.imbalances(part))
      if (token.tag !== 'dust' && value !== 0n) throw new Error('Non-DUST value imbalance.');
  }
  return intent;
}

function readProved(value: Uint8Array): Proved {
  return Transaction.deserialize('signature', 'proof', 'pre-binding', value);
}

/**
 * Assemble one proved ACC call and a separate proved DUST-only intent.
 * The host supplies a trusted digest of the original call and an approved fee
 * cap and deadline. Ledger settlement verifies the proofs and state.
 */
export async function assembleDustFee(input: DustFeeAssemblyInput): Promise<Uint8Array> {
  const parsed = request.safeParse(input);
  if (!parsed.success)
    throw new PassportConnectorError('InternalError', 'Invalid DUST fee assembly input.');
  const scope = parsed.data;
  const accountBytes = new Uint8Array(scope.provedAccount);
  const feeBytes = new Uint8Array(scope.provedFee);
  try {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', accountBytes));
    const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
    const circuitPin = resolveBinding(scope.bindingId).circuits[scope.circuit];
    if (hash !== scope.accountSha256 || !circuitPin?.proof || !circuitPin.hashes)
      throw new Error('The account proof differs from the approved binding and call.');

    const now = Date.now();
    const account = readProved(accountBytes);
    const fee = readProved(feeBytes);
    const callIntent = singleIntent(account, scope.networkId, now);
    const [call] = callIntent.actions;
    if (
      callIntent.actions.length !== 1 ||
      !(call instanceof ContractCall) ||
      callIntent.dustActions ||
      call.address !== scope.address
    )
      throw new Error('Expected the approved fee-free ACC call.');
    const name =
      typeof call.entryPoint === 'string'
        ? call.entryPoint
        : new TextDecoder('utf-8', { fatal: true }).decode(call.entryPoint);
    if (name !== scope.circuit) throw new Error('Expected the approved ACC circuit.');

    const feeIntent = singleIntent(fee, scope.networkId, now);
    const dust = feeIntent.dustActions;
    const spends = dust?.spends ?? [];
    if (
      feeIntent.actions.length ||
      !spends.length ||
      dust?.registrations.length ||
      feeIntent.ttl.getTime() > Math.min(scope.feeExpiresByMs, callIntent.ttl.getTime()) ||
      spends.reduce((total, spend) => total + spend.vFee, 0n) > scope.maxDust
    )
      throw new Error('The DUST fee exceeds its approved scope.');

    const result = account.bind().merge(fee.bind()).serialize();
    if (result.byteLength > maximumBytes)
      throw new Error('Combined transaction exceeds its limit.');
    return result;
  } catch {
    throw new PassportConnectorError('SponsorRejected', 'DUST fee assembly refused.');
  } finally {
    accountBytes.fill(0);
    feeBytes.fill(0);
  }
}
