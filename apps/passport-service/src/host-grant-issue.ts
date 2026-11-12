import { isDeepStrictEqual } from 'node:util';
import type * as Ledger from '@midnightntwrk/ledger-v9';
import {
  grantIssueHostRequestId,
  grantIssueOwnerCircuit,
  MAX_HOST_GRANT_ISSUE_BYTES,
} from '@input-output-hk/mn-passport-protocol';
import {
  hostFailure,
  sponsorPolicy,
  viewOfLedgerTx,
  type HostJson,
  type HostMutationIdentity,
  type HostMutationPlan,
} from '@input-output-hk/mn-passport-service';
import { z } from 'zod';
import { bytes, hex, intents, same } from './host-ledger.ts';
import type { ProvenTx, ReferenceHostRuntime } from './reference-runtime.ts';

const address = z.string().regex(/^[0-9a-f]{64}$/);
const circuit = z.enum(['issue_grant_with_p256', 'issue_grant_with_jubjub']);
const requestSchema = z.strictObject({
  kind: z.literal('grant-issue-v1'),
  requestId: z.uuid(),
  address,
  circuit,
  tx: z
    .string()
    .min(2)
    .max(MAX_HOST_GRANT_ISSUE_BYTES * 2)
    .regex(/^(?:[0-9a-f]{2})+$/),
});
export const grantIssueContext = z.object({
  kind: z.literal('call'),
  driver: z.literal('reference-v9-grant-issue:1'),
});
type GrantIssueRequest = z.infer<typeof requestSchema>;

function grantCall<P extends Ledger.Proofish, B extends Ledger.Bindingish>(
  ledger: ReferenceHostRuntime['ledger'],
  tx: Ledger.Transaction<Ledger.SignatureEnabled, P, B>,
  request: GrantIssueRequest,
) {
  const actions = intents(tx).flatMap((intent) => intent.actions);
  const [call] = actions;
  if (
    actions.length !== 1 ||
    !(call instanceof ledger.ContractCall) ||
    call.address !== request.address
  )
    return hostFailure();
  const name =
    typeof call.entryPoint === 'string'
      ? call.entryPoint
      : Buffer.from(call.entryPoint).toString('utf8');
  if (name !== request.circuit || !call.communicationCommitment) return hostFailure();
  return call;
}

function admittedInput(r: ReferenceHostRuntime, request: GrantIssueRequest): ProvenTx {
  if (!r.allowGrantIssue || r.networkId !== 'undeployed' || !r.allowedAccount(request.address))
    return hostFailure();
  const tx = r.ledger.Transaction.deserialize<
    Ledger.SignatureEnabled,
    Ledger.Proof,
    Ledger.PreBinding
  >('signature', 'proof', 'pre-binding', bytes(request.tx));
  grantCall(r.ledger, tx, request);
  if (intents(tx).some(({ ttl }) => !(ttl.getTime() > Date.now() + 10_000))) return hostFailure();
  if (sponsorPolicy(viewOfLedgerTx(tx, r.ledger), new Set([request.address])) !== undefined)
    return hostFailure();
  return tx;
}

export function readHostGrantIssueRequest(input: HostJson): GrantIssueRequest {
  const parsed = requestSchema.safeParse(input);
  return parsed.success ? parsed.data : hostFailure();
}

export async function prepareHostGrantIssue(
  r: ReferenceHostRuntime,
  identity: HostMutationIdentity,
  input: HostJson,
  isPinnedAccount: (address: string) => Promise<boolean>,
): Promise<HostMutationPlan> {
  const request = readHostGrantIssueRequest(input);
  if (
    identity.kind !== 'call' ||
    identity.pins.networkId !== r.networkId ||
    identity.pins.bindingId !== 'acc-s3r1.1' ||
    identity.requestId !== grantIssueHostRequestId(request.requestId) ||
    request.circuit !== grantIssueOwnerCircuit(identity.pins.scheme)
  )
    return hostFailure();
  admittedInput(r, request);
  if (!(await isPinnedAccount(request.address))) return hostFailure();
  return {
    address: request.address,
    steps: 1,
    context: {
      kind: 'call',
      driver: 'reference-v9-grant-issue:1',
    },
  };
}

/** Balance only the retained, proved fee-only issue call, and pin its commitment across the wallet. */
export async function balanceHostGrantIssue(r: ReferenceHostRuntime, request: GrantIssueRequest) {
  const original = admittedInput(r, request);
  const approved = grantCall(r.ledger, original, request);
  const { tx } = await r.providers.walletProvider.balanceTx({ version: 'v9', tx: original });
  const result = grantCall(r.ledger, tx, request);
  if (
    result.communicationCommitment !== approved.communicationCommitment ||
    !same(result.proof.serialize(), approved.proof.serialize()) ||
    !isDeepStrictEqual(result.guaranteedTranscript, approved.guaranteedTranscript) ||
    !isDeepStrictEqual(result.fallibleTranscript, approved.fallibleTranscript)
  )
    return hostFailure();
  const view = viewOfLedgerTx(tx, r.ledger);
  for (const intent of intents(tx)) {
    if (intent.dustActions?.registrations.length) return hostFailure();
  }
  // The wallet may add Dust spends for fees. It must not add any other asset
  // offers, rewards, or effects to the original call.
  const feeOnly = {
    ...view,
    intents: new Map(
      [...(view.intents ?? [])].map(([segment, { dustActions: _, ...intent }]) => [
        segment,
        intent,
      ]),
    ),
  };
  if (sponsorPolicy(feeOnly, new Set([request.address])) !== undefined) return hostFailure();
  const serialized = tx.serialize();
  if (!serialized.length || serialized.length > MAX_HOST_GRANT_ISSUE_BYTES) return hostFailure();
  return { tx: hex(serialized), identifiers: tx.identifiers().map(String) };
}
