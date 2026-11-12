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
export interface GuardianCollectionAttempt extends Readonly<GuardianSession> {
  readonly attemptId: string;
}
export interface GuardianShareRequest extends GuardianCollectionAttempt {
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

const cancelled = () =>
  new PassportConnectorError('Aborted', 'Guardian share collection was cancelled.');

function checkSignal(signal?: AbortSignalLike): void {
  if (signal?.aborted) throw cancelled();
}

function erase(response: AuthenticatedGuardianShare | undefined): void {
  if (response?.share instanceof Uint8Array) response.share.fill(0);
}

function requestWithAbort(
  transport: RecoveryGuardianTransport,
  request: GuardianShareRequest,
  signal?: AbortSignalLike,
): Promise<AuthenticatedGuardianShare | undefined> {
  const pending = transport.requestShare(request, signal);
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const detach = () => signal.removeEventListener('abort', abort);
    const abort = () => {
      detach();
      reject(cancelled());
    };
    signal.addEventListener('abort', abort);
    if (signal.aborted) abort();
    void pending.then(
      (response) => {
        detach();
        if (signal.aborted) erase(response);
        else resolve(response);
      },
      (error: unknown) => {
        detach();
        reject(error);
      },
    );
  });
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

/** Prepare recovery with mutually authenticated shares. The callback must not submit a mutation. */
export function createRecoveryGuardianCollector(transport: RecoveryGuardianTransport) {
  let collecting = false;
  return async function withShares<T>(
    input: GuardianSession,
    roster: { readonly indices: readonly number[]; readonly threshold: number },
    assertCurrent: (session: GuardianSession) => Promise<void>,
    prepare: (
      shares: readonly IndexedRecoveryShare[],
      attempt: GuardianCollectionAttempt,
    ) => Promise<T>,
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
    const attempt = Object.freeze({ ...session, attemptId: toHex(randomBytes(16)) });
    const shares: IndexedRecoveryShare[] = [];
    collecting = true;
    try {
      checkSignal(signal);
      await assertCurrent(session);
      for (const index of indices) {
        checkSignal(signal);
        const request = Object.freeze({ ...attempt, index });
        const response = await requestWithAbort(transport, request, signal);
        try {
          checkSignal(signal);
          if (response && matches(response, request))
            shares.push(Object.freeze({ index, share: Uint8Array.from(response.share) }));
        } finally {
          erase(response);
        }
      }
      if (shares.length < threshold)
        throw new PassportConnectorError(
          'MutationUnsettled',
          'The guardian threshold was not met.',
        );
      await assertCurrent(session);
      checkSignal(signal);
      const prepared = await prepare(Object.freeze(shares), attempt);
      checkSignal(signal);
      return prepared;
    } finally {
      for (const { share } of shares) share.fill(0);
      collecting = false;
    }
  };
}
