import { randomBytes } from '@noble/hashes/utils.js';
import type { AbortSignalLike } from '@input-output-hk/mn-passport-protocol';
import { z } from 'zod';
import { toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { AccountContextSchema } from './validation.js';

const indexSchema = z.number().int().min(1).max(255);
const contextSchema = AccountContextSchema.unwrap()
  .strict()
  .extend({
    sessionId: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .refine((id) => id !== '00'.repeat(32)),
  })
  .readonly();
const rosterSchema = z.strictObject({
  indices: z.array(indexSchema).min(1).max(255),
  threshold: indexSchema,
});

export type GuardianSession = z.input<typeof contextSchema>;
export interface GuardianShareRequest extends GuardianSession {
  readonly attemptId: string;
  readonly index: number;
}
export interface AuthenticatedGuardianShare extends GuardianShareRequest {
  /** Ownership transfers to the collector, which clears this buffer. */
  readonly share: Uint8Array;
}
export interface RecoveryGuardianTransport {
  /** Authenticate both endpoints and the response. Resolve undefined for a refusing or unavailable guardian. */
  requestShare(
    request: GuardianShareRequest,
    signal?: AbortSignalLike,
  ): Promise<AuthenticatedGuardianShare | undefined>;
}
export interface IndexedRecoveryShare {
  readonly index: number;
  readonly share: Uint8Array;
}

function checkSignal(signal?: AbortSignalLike): void {
  if (signal?.aborted)
    throw new PassportConnectorError('Aborted', 'Guardian share collection was cancelled.');
}

function matches(response: AuthenticatedGuardianShare, request: GuardianShareRequest): boolean {
  return (
    response.account === request.account &&
    response.bindingId === request.bindingId &&
    response.networkId === request.networkId &&
    response.sessionId === request.sessionId &&
    response.attemptId === request.attemptId &&
    response.index === request.index &&
    response.share instanceof Uint8Array &&
    response.share.length === 32
  );
}

/** Use a mutually authenticated transport. Shares are in memory for one scoped callback. */
export function createRecoveryGuardianCollector(transport: RecoveryGuardianTransport) {
  let collecting = false;
  return async function withShares<T>(
    input: GuardianSession,
    roster: { readonly indices: readonly number[]; readonly threshold: number },
    assertCurrent: (session: GuardianSession) => Promise<void>,
    use: (shares: readonly IndexedRecoveryShare[]) => Promise<T>,
    signal?: AbortSignalLike,
  ): Promise<T> {
    if (collecting)
      throw new PassportConnectorError(
        'MutationUnsettled',
        'Guardian collection is already active.',
      );
    const session = contextSchema.parse(input);
    const { indices, threshold } = rosterSchema.parse(roster);
    if (new Set(indices).size !== indices.length || threshold > indices.length)
      throw new TypeError('Invalid guardian roster or threshold.');
    const attemptId = toHex(randomBytes(16));
    const shares: IndexedRecoveryShare[] = [];
    collecting = true;
    try {
      checkSignal(signal);
      await assertCurrent(session);
      for (const index of indices) {
        checkSignal(signal);
        const request = Object.freeze({ ...session, attemptId, index });
        const response = await transport.requestShare(request, signal);
        try {
          checkSignal(signal);
          if (response && matches(response, request))
            shares.push(Object.freeze({ index, share: Uint8Array.from(response.share) }));
        } finally {
          if (response?.share instanceof Uint8Array) response.share.fill(0);
        }
      }
      if (shares.length < threshold)
        throw new PassportConnectorError(
          'MutationUnsettled',
          'The guardian threshold was not met.',
        );
      await assertCurrent(session);
      checkSignal(signal);
      return await use(Object.freeze(shares));
    } finally {
      for (const { share } of shares) share.fill(0);
      collecting = false;
    }
  };
}
