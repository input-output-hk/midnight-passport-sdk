import { P256_GRANT_SPEND_CIRCUIT, type FlowOptions } from '@input-output-hk/mn-passport-protocol';
import { toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { grantScopeInvalid as invalid } from './grant-issue-fields.js';
import type { UnshieldedGrantSpendResult } from './grant-holder.js';
import { mutationDigest } from './mutation-codec.js';
import {
  assertP256SpendLive,
  checkP256Spend,
  matchesP256Scope,
  p256GrantSpendSchema,
  type P256GrantSpendIntent,
  type P256GrantSpendPure,
} from './p256-grant-spend-check.js';
import type {
  PinnedChain,
  MutationSubmissionContext,
  P256GrantSpendSource,
} from './ports/index.js';
import type { PasskeyCredential, PasskeySeam, PasskeySignature } from './seams.js';
import { NetworkIdSchema } from './validation.js';

export type { P256GrantSpendIntent, P256GrantSpendPure } from './p256-grant-spend-check.js';

export interface P256GrantSpendReservation extends MutationSubmissionContext {
  readonly networkId: string;
  readonly account: string;
  readonly grantId: string;
  readonly issuedAt: string;
  readonly previousNonce: string;
  readonly expectedSpentCommit: string;
}

export interface P256GrantSpendJournal {
  /** Read a prior reservation without opening a credential ceremony. */
  read(requestId: string): Promise<{ readonly txHash?: string } | undefined>;
  /**
   * Atomically persist the original dispatch fence before returning true.
   * Return false for an occupied request ID, including an identical attempt.
   */
  reserve(reservation: P256GrantSpendReservation): Promise<boolean>;
  /** Retain the exact transaction hash against the reserved request and digest. */
  recordTransaction(reservation: P256GrantSpendReservation, txHash: string): Promise<void>;
}

export interface P256GrantSpendPorts {
  /** Must identify the same pinned network as the live reader and value-capable chain. */
  readonly networkId: string;
  readonly pure: P256GrantSpendPure;
  readonly source: P256GrantSpendSource;
  readonly chain: Pick<PinnedChain, 'call' | 'networkId' | 'bindingId'>;
  readonly grantee: PasskeyCredential;
  readonly passkey: Pick<PasskeySeam, 'sign'>;
  readonly journal: P256GrantSpendJournal;
  readonly review: (intent: {
    readonly networkId: string;
    readonly account: string;
    readonly grantId: string;
    readonly color: string;
    readonly amount: string;
    readonly recipient: string;
    readonly remainingCap: string;
  }) => Promise<boolean>;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly nowSeconds?: () => number;
  readonly attempts?: number;
}

export class P256GrantSpendUnsettled extends PassportConnectorError {
  constructor(
    readonly requestId: string,
    readonly txHash?: string,
    cause?: unknown,
  ) {
    super(
      'MutationUnsettled',
      `Reconcile original P-256 grant spend ${requestId} before submitting another.`,
      { retryable: false, cause },
    );
  }
}

function checkpoint(options: FlowOptions): void {
  if (options.signal?.aborted)
    throw new PassportConnectorError('Aborted', 'Grant spend cancelled.');
}

/** Review, sign and submit one fixed-recipient grant withdrawal with its own passkey. */
export async function spendUnshieldedWithP256Grant(
  input: P256GrantSpendIntent,
  ports: P256GrantSpendPorts,
  options: FlowOptions = {},
): Promise<UnshieldedGrantSpendResult> {
  const parsed = p256GrantSpendSchema.safeParse(input);
  if (!parsed.success) return invalid('malformed P-256 grant spend');
  const { opening, amount, requestId } = parsed.data;
  const { account, color, recipient } = opening.scope;
  const { networkId, pure, source, chain, journal } = ports;
  if (!NetworkIdSchema.safeParse(networkId).success) return invalid('malformed network ID');
  assertP256GrantPins(networkId, source, chain);
  const attempts = ports.attempts ?? 30;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 120)
    return invalid('invalid settlement polling bound');
  const now = ports.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  checkpoint(options);
  const prior = await journal.read(requestId);
  if (prior) throw new P256GrantSpendUnsettled(requestId, prior.txHash);
  checkpoint(options);
  const spend = checkP256Spend(parsed.data, ports.grantee, pure);
  const read = () => source.readP256GrantSpendContext(account, opening.grantId);
  const first = await read();
  assertP256GrantPins(networkId, source, chain);
  assertP256SpendLive(first, spend, now());
  const { issuedAt, nonce, grantEpoch, grantGeneration } = first;
  const isOriginal = (live: typeof first) =>
    live.issuedAt === issuedAt &&
    live.grantEpoch === grantEpoch &&
    live.grantGeneration === grantGeneration;
  const recheck = async () => {
    const latest = await read();
    assertP256GrantPins(networkId, source, chain);
    assertP256SpendLive(latest, spend, now());
    if (!isOriginal(latest) || latest.nonce !== nonce)
      throw new PassportConnectorError(
        'GrantRosterUnsettled',
        'The grant changed during approval.',
      );
    checkpoint(options);
  };
  checkpoint(options);
  const reviewed = Object.freeze({
    networkId,
    account,
    grantId: opening.grantId,
    color,
    amount,
    recipient,
    remainingCap: (spend.cap - spend.spentPrev).toString(),
  });
  if (!(await ports.review(reviewed)))
    throw new PassportConnectorError('UserCancelled', 'Grant spend was declined.');
  await recheck();
  const challenge = pure.challenge_withdraw_unshielded_with_grant_p256(
    spend.account,
    spend.credential.publicKey,
    spend.id,
    issuedAt,
    spend.color,
    spend.amount,
    spend.recipient,
    nonce,
  );
  if (challenge.length !== 32) return invalid('binding returned an invalid grant challenge');
  const signature = await ports.passkey.sign(
    structuredCloneCredential(spend.credential),
    challenge,
  );
  const assertion = checkedAssertion(signature, opening.scope.grantee.rpIdHash);
  await recheck();

  const reservation = Object.freeze({
    requestId,
    intentSha256: mutationDigest({
      circuit: P256_GRANT_SPEND_CIRCUIT,
      reviewed,
      nonce,
      issuedAt,
      grantEpoch,
      grantGeneration,
      rpCommit: spend.rpCommit,
      objectCommit: spend.objectCommit,
      spentCommit: spend.spentCommit,
      nextSpentCommit: spend.nextSpentCommit,
    }),
    networkId,
    account,
    grantId: opening.grantId,
    issuedAt: issuedAt.toString(),
    previousNonce: nonce.toString(),
    expectedSpentCommit: spend.nextSpentCommit,
  });
  let txHash: string | undefined;
  try {
    if (!(await journal.reserve(reservation))) throw new P256GrantSpendUnsettled(requestId);
    await recheck();
    const tx = await chain.call({
      ...options,
      address: account,
      circuit: P256_GRANT_SPEND_CIRCUIT,
      args: [
        spend.color,
        spend.amount,
        spend.recipient,
        spend.originHash,
        spend.slot,
        spend.salt,
        1n,
        spend.recipient.bytes,
        spend.maxCoin,
        spend.spentPrev,
        { pk: spend.credential.publicKey, policy: spend.credential.policy, ...assertion },
      ],
      mutation: { requestId, intentSha256: reservation.intentSha256 },
    });
    txHash = tx.txHash;
    await journal.recordTransaction(reservation, txHash);
    const spentTotal = spend.spentPrev + spend.amount;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const settled = await read();
      if (
        settled &&
        isOriginal(settled) &&
        matchesP256Scope(settled, spend) &&
        settled.nonce === nonce + 1n &&
        toHex(settled.spentCommit) === spend.nextSpentCommit
      ) {
        return { ...tx, grantId: opening.grantId, spentTotal, grantNonce: settled.nonce };
      }
      if (attempt + 1 < attempts) await ports.sleep(1000);
    }
  } catch (error) {
    if (error instanceof P256GrantSpendUnsettled) throw error;
    throw new P256GrantSpendUnsettled(requestId, txHash, error);
  }
  throw new P256GrantSpendUnsettled(requestId, txHash);
}

function assertP256GrantPins(
  networkId: string,
  source: P256GrantSpendSource,
  chain: P256GrantSpendPorts['chain'],
): void {
  if (source.networkId !== networkId || chain.networkId !== networkId)
    throw new PassportConnectorError(
      'NetworkMismatch',
      'The grant reader and chain must use the reviewed network.',
    );
  if (source.bindingId !== 'acc-s3r1.1' || chain.bindingId !== source.bindingId)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'The grant reader and chain must use acc-s3r1.1.',
    );
}

function checkedAssertion(signature: PasskeySignature, rpIdHash: string): PasskeySignature {
  if (
    !(signature.authenticator_data instanceof Uint8Array) ||
    signature.authenticator_data.length !== 37 ||
    ((signature.authenticator_data[32] ?? 0) & 5) !== 5 ||
    toHex(signature.authenticator_data.subarray(0, 32)) !== rpIdHash
  )
    throw new PassportConnectorError(
      'NotAuthorised',
      'The assertion does not match the grant policy.',
    );
  return {
    authenticator_data: Uint8Array.from(signature.authenticator_data),
    sig: { ...signature.sig },
  };
}

function structuredCloneCredential(credential: PasskeyCredential): PasskeyCredential {
  return {
    credentialId: Uint8Array.from(credential.credentialId),
    publicKey: { ...credential.publicKey },
    policy: {
      origin: Uint8Array.from(credential.policy.origin),
      rp_id_hash: Uint8Array.from(credential.policy.rp_id_hash),
    },
  };
}
