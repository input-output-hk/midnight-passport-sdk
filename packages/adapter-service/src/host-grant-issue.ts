import {
  grantIssueHostRequestId,
  grantIssueOwnerCircuit,
  MAX_HOST_GRANT_ISSUE_BYTES,
  type AbortSignalLike,
} from '@input-output-hk/mn-passport-protocol';
import type { MutationPins } from '@input-output-hk/mn-passport-account/ports';
import { toHex } from './hex.js';
import {
  mutationIdentity,
  mutationFailure,
  type MutationIdentity,
  type RemoteOutcome,
} from './host-mutation-outcome.js';

export interface HostGrantIssueReference {
  readonly requestId: string;
  readonly intentSha256: string;
}

export interface RemoteHostGrantIssuePort {
  /** Send the proved, unbound owner call through the private host RPC. */
  execute(
    proven: Uint8Array,
    request: HostGrantIssueReference & { readonly address: string; readonly circuit: string },
    signal?: AbortSignalLike,
  ): Promise<{
    readonly txHash: string;
    readonly submissionId: string;
    readonly blockHeight?: number;
  }>;
  /** Observe or continue the retained original call. It cannot replace the input bytes. */
  reconcile(
    original: HostGrantIssueReference,
    signal?: AbortSignalLike,
  ): Promise<
    | { readonly txHash: string; readonly submissionId: string; readonly blockHeight?: number }
    | undefined
  >;
}

export function remoteGrantIssuePort(
  pinned: MutationPins,
  finish: (
    identity: MutationIdentity,
    input: unknown,
    signal: AbortSignalLike | undefined,
    deadline: number,
  ) => Promise<RemoteOutcome>,
  observe: (
    identity: MutationIdentity,
    input: undefined,
    signal?: AbortSignalLike,
  ) => Promise<RemoteOutcome>,
  timeout: number,
): RemoteHostGrantIssuePort {
  const grantIdentity = (request: HostGrantIssueReference) => {
    const key = grantIssueHostRequestId(request.requestId);
    if (!key || pinned.networkId !== 'undeployed' || pinned.bindingId !== 'acc-s3r1.1')
      return mutationFailure();
    return mutationIdentity(pinned, key, request.intentSha256, 'call');
  };
  const callResult = (answer: RemoteOutcome) =>
    answer.kind === 'confirmed' && 'txHash' in answer.result ? answer.result : undefined;
  return {
    async execute(proven, request, signal) {
      const deadline = performance.now() + timeout;
      const { address, circuit, requestId } = request;
      if (
        (pinned.scheme !== 'p256-webauthn' && pinned.scheme !== 'jubjub-schnorr') ||
        circuit !== grantIssueOwnerCircuit(pinned.scheme) ||
        address.length !== 64 ||
        !/^[0-9a-f]{64}$/.test(address) ||
        !(proven instanceof Uint8Array) ||
        proven.length === 0 ||
        proven.length > MAX_HOST_GRANT_ISSUE_BYTES
      )
        return mutationFailure();
      const original = grantIdentity({ requestId, intentSha256: request.intentSha256 });
      const result = await finish(
        original,
        {
          kind: 'grant-issue-v1',
          requestId,
          address,
          circuit,
          tx: toHex(new Uint8Array(proven)),
        },
        signal,
        deadline,
      );
      return callResult(result) ?? mutationFailure();
    },
    async reconcile(original, signal) {
      const id = grantIdentity(original);
      return callResult(await observe(id, undefined, signal));
    },
  };
}
