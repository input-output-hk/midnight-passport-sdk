import { ContractCall, type Transaction } from '@midnightntwrk/ledger-v9';
import type { ClaimScope } from './claim-receipt.js';
import { matchesClaimWrites } from './claim-transcript.js';

export function findStandaloneClaimCall(
  tx: ReturnType<typeof Transaction.deserialize>,
  original: ClaimScope,
) {
  const actions = [...(tx.intents?.values() ?? [])].flatMap((intent) => intent.actions);
  const [call] = actions;
  if (
    actions.length !== 1 ||
    !(call instanceof ContractCall) ||
    call.address !== original.registryAddress
  )
    return undefined;
  const entry =
    typeof call.entryPoint === 'string'
      ? call.entryPoint
      : new TextDecoder().decode(call.entryPoint);
  if (
    entry !== 'create_domain' ||
    !matchesClaimWrites(
      [call.guaranteedTranscript?.program ?? [], call.fallibleTranscript?.program ?? []],
      original,
    )
  )
    return undefined;
  return call;
}
