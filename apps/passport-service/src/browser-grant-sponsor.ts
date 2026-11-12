import { grantIssueHostRequestId } from '@input-output-hk/mn-passport-protocol';
import {
  hostFailure,
  type createHostMutationExecutor,
  type HostMutationOutcome,
  type HostMutationIdentity,
  type serial,
} from '@input-output-hk/mn-passport-service';
import type { BrowserGrantRelayOptions } from './routes/browser-grant.ts';

type Executor = Pick<ReturnType<typeof createHostMutationExecutor>, 'execute' | 'resume'>;

type GrantIssueRequest = Parameters<BrowserGrantRelayOptions['sponsor']['execute']>[1];

export function browserGrantHostInput(tx: string, request: GrantIssueRequest) {
  const { address, circuit, requestId, validUntilSeconds } = request;
  return {
    kind: 'grant-issue-v1',
    address,
    circuit,
    requestId,
    tx,
    ...(validUntilSeconds !== undefined && { validUntilSeconds }),
  };
}

export function createBrowserGrantSponsor(
  executor: Executor,
  pins: Omit<HostMutationIdentity['pins'], 'scheme'>,
  exclusive: ReturnType<typeof serial>,
): BrowserGrantRelayOptions['sponsor'] {
  function identity({ requestId, intentSha256 }: { requestId: string; intentSha256: string }) {
    const id = grantIssueHostRequestId(requestId);
    if (!id) return hostFailure();
    return {
      pins: { ...pins, scheme: 'p256-webauthn' },
      kind: 'call',
      requestId: id,
      intentSha256,
    } as const;
  }
  function receipt(outcome: HostMutationOutcome) {
    return outcome.kind === 'confirmed' && 'txHash' in outcome.result ? outcome.result : undefined;
  }
  return {
    execute(bytes, request, context) {
      const input = browserGrantHostInput(Buffer.from(bytes).toString('hex'), request);
      return exclusive(async () =>
        receipt(await executor.execute(identity(request), input, context)),
      );
    },
    reconcile(original, context) {
      return exclusive(async () => receipt(await executor.resume(identity(original), context)));
    },
  };
}
