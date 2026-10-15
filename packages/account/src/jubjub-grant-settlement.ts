import type { PassportTxResult } from '@input-output-hk/mn-passport-protocol';
import {
  issueJubjubGrantCall,
  type IssueJubjubGrantCallInput,
  type IssueJubjubGrantCallPorts,
} from './jubjub-grant-issue.js';
import {
  publishJubjubGrantBookkeeping,
  type PublishJubjubGrantPorts,
} from './jubjub-grant-publication.js';

export type IssueAndPublishJubjubGrantPorts = IssueJubjubGrantCallPorts & PublishJubjubGrantPorts;

export interface ActiveJubjubGrantResult extends PassportTxResult {
  readonly grantId: string;
  readonly slot: number;
  readonly scopeDigest: string;
  readonly status: 'active';
  readonly appendTxHashes: readonly string[];
  readonly nextUseCounter: bigint;
}

/**
 * Issue an unshielded spend grant and publish its sealed bookkeeping before returning it as active.
 * If settlement is interrupted after submission, the durable journal retains the opening. Resume
 * with `publishJubjubGrantBookkeeping` using the staged grant ID after checking the live ACC roster.
 */
export async function issueAndPublishJubjubGrant(
  input: IssueJubjubGrantCallInput,
  ports: IssueAndPublishJubjubGrantPorts,
): Promise<ActiveJubjubGrantResult> {
  const submitted = await issueJubjubGrantCall(input, ports);
  const published = await publishJubjubGrantBookkeeping(
    {
      hint: input.hint,
      grantId: submitted.grantId,
      ...(input.signal && { signal: input.signal }),
      ...(input.onEvent && { onEvent: input.onEvent }),
    },
    ports,
  );
  return {
    txHash: submitted.txHash,
    ...(submitted.blockHeight !== undefined && { blockHeight: submitted.blockHeight }),
    grantId: submitted.grantId,
    slot: submitted.slot,
    scopeDigest: submitted.scopeDigest,
    status: published.status,
    appendTxHashes: published.appendTxHashes,
    nextUseCounter: published.nextUseCounter,
  };
}
