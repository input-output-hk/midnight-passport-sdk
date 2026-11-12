import {
  Transaction,
  type Proof,
  type PreBinding,
  type SignatureEnabled,
  type UnprovenTransaction,
} from '@midnightntwrk/ledger-v9';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type {
  CallRequest,
  GrantIssueSponsorPort,
  NetworkConfig,
  Prover,
} from '@input-output-hk/mn-passport-account/ports';
import {
  grantIssueHostRequestId,
  MAX_HOST_GRANT_ISSUE_BYTES,
} from '@input-output-hk/mn-passport-protocol';
import { singleContractCall } from './single-contract-call.js';

function unsettled(): never {
  throw new PassportConnectorError(
    'MutationUnsettled',
    'The original grant issue could not be handed to the sponsor.',
  );
}

type Track = <T>(step: 'prove' | 'sponsor.submit', work: () => Promise<T>) => Promise<T>;

export function handoffGrantIssue(
  network: NetworkConfig,
  prover: Prover,
  sponsor: GrantIssueSponsorPort,
  build: (
    request: Pick<CallRequest, 'address' | 'circuit' | 'args'>,
  ) => Promise<UnprovenTransaction>,
) {
  return async (request: CallRequest, track: Track) => {
    const { address, circuit, mutation, signal } = request;
    if (
      network.networkId !== 'undeployed' ||
      network.bindingId !== 'acc-s3r1.1' ||
      request.heldCoin !== undefined ||
      !mutation ||
      !grantIssueHostRequestId(mutation.requestId) ||
      typeof mutation.intentSha256 !== 'string' ||
      mutation.intentSha256.length !== 64 ||
      !/^[0-9a-f]{64}$/.test(mutation.intentSha256)
    )
      return unsettled();
    const original = { ...mutation, address, circuit };
    const check = () => {
      const deadline = original.validUntilSeconds;
      if (
        signal?.aborted ||
        (deadline !== undefined &&
          (!Number.isSafeInteger(deadline) || Math.floor(Date.now() / 1000) > deadline))
      )
        return unsettled();
    };
    check();
    const args = structuredClone(request.args);
    const built = await build({ address, circuit, args });
    const initial = singleContractCall(built, address, circuit);
    if (!initial?.call.communicationCommitment) return unsettled();
    const template = built.eraseProofs().serialize();
    check();
    const bytes = await track('prove', async () => {
      const result = await prover.proveTx(built.serialize(), {
        ...(signal && { signal }),
        networkId: network.networkId,
        bindingId: network.bindingId,
        circuits: [circuit],
      });
      if (result.tx.length === 0 || result.tx.length > MAX_HOST_GRANT_ISSUE_BYTES)
        return unsettled();
      const owned = new Uint8Array(result.tx);
      const proved = Transaction.deserialize<SignatureEnabled, Proof, PreBinding>(
        'signature',
        'proof',
        'pre-binding',
        owned,
      );
      const finalCall = singleContractCall(proved, address, circuit);
      const erased = proved.eraseProofs().serialize();
      if (
        !finalCall ||
        finalCall.call.communicationCommitment !== initial.call.communicationCommitment ||
        erased.length !== template.length ||
        !erased.every((byte, index) => byte === template[index])
      )
        return unsettled();
      check();
      return owned;
    });
    const { txHash, blockHeight } = await track('sponsor.submit', () => {
      check();
      return sponsor.execute(bytes, original, signal);
    });
    return { txHash, ...(blockHeight !== undefined && { blockHeight }) };
  };
}
