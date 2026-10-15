import type { PassportGrantIssueResult } from '@input-output-hk/mn-passport-protocol';
import { PassportConnectorError, toPassportError } from './errors.js';
import {
  issueJubjubGrantCall,
  type IssueJubjubGrantCallInput,
  type IssueJubjubGrantCallPorts,
  type SubmittedJubjubGrantCall,
} from './jubjub-grant-issue.js';
import {
  publishJubjubGrantBookkeeping,
  type PublishJubjubGrantPorts,
} from './jubjub-grant-publication.js';

export type IssueAndPublishJubjubGrantPorts = IssueJubjubGrantCallPorts & PublishJubjubGrantPorts;

export type ActiveJubjubGrantResult = PassportGrantIssueResult;

/** An accepted issue whose publication did not finish; the caller can resume by grant ID. */
export class SubmittedGrantSettlementError extends PassportConnectorError {
  readonly grantId: string;
  readonly txHash: string;

  constructor(error: unknown, submitted: SubmittedJubjubGrantCall) {
    const cause = toPassportError(error);
    super(cause.code, cause.message, {
      cause,
      retryable: cause.retryable,
      ...(cause.step !== undefined && { step: cause.step }),
    });
    this.grantId = submitted.grantId;
    this.txHash = submitted.txHash;
  }
}

/**
 * Issue a grant and publish its sealed bookkeeping and any read seal before returning it as active.
 * If settlement is interrupted after submission, the durable journal retains the opening. Resume
 * with `publishJubjubGrantBookkeeping` using the staged grant ID after checking the live ACC roster.
 */
export async function issueAndPublishJubjubGrant(
  input: IssueJubjubGrantCallInput,
  ports: IssueAndPublishJubjubGrantPorts,
): Promise<ActiveJubjubGrantResult> {
  const submitted = await issueJubjubGrantCall(input, ports);
  let published;
  try {
    published = await publishJubjubGrantBookkeeping(
      {
        hint: input.hint,
        grantId: submitted.grantId,
        ...(input.signal && { signal: input.signal }),
        ...(input.onEvent && { onEvent: input.onEvent }),
      },
      ports,
    );
  } catch (error) {
    throw new SubmittedGrantSettlementError(error, submitted);
  }
  return {
    txHash: submitted.txHash,
    ...(submitted.blockHeight !== undefined && { blockHeight: submitted.blockHeight }),
    grantId: submitted.grantId,
    slot: submitted.slot,
    scopeDigest: submitted.scopeDigest,
    status: published.status,
    appendTxHashes: published.appendTxHashes,
    nextUseCounter: published.nextUseCounter,
    ...(submitted.rotation && { rotation: submitted.rotation }),
    ...(published.sealedReadGrant && { sealedReadGrant: published.sealedReadGrant }),
  };
}
