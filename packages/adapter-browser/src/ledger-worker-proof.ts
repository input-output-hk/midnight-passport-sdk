import { resolveBinding } from '@input-output-hk/mn-passport-contract';
import { encodeContractKeyLocation } from '@midnight-ntwrk/compact-js/effect/ContractKeyLocation';
import {
  ContractCall,
  CostModel,
  Transaction,
  type PreBinding,
  type PreProof,
  type ProvingProvider,
  type SignatureEnabled,
} from '@midnightntwrk/ledger-v9';

export async function proveWorkerTransaction(
  bytes: Uint8Array,
  scope: {
    readonly networkId: string;
    readonly bindingId: string;
    readonly circuits: readonly string[];
  },
  provider: ProvingProvider,
): Promise<Uint8Array> {
  const tx = Transaction.deserialize<SignatureEnabled, PreProof, PreBinding>(
    'signature',
    'pre-proof',
    'pre-binding',
    bytes,
  );
  // Ledger checks network equality when merging. Use the empty transaction only as a check.
  tx.eraseProofs().merge(Transaction.fromParts(scope.networkId).eraseProofs());
  const intents = [...(tx.intents?.values() ?? [])];
  if (tx.guaranteedOffer || tx.fallibleOffer?.size || intents.some((intent) => intent.dustActions))
    throw new Error('This worker profile proves ACC calls before wallet fee or shielded proofs.');
  const binding = resolveBinding(scope.bindingId);
  const used = new Set<string>();
  const locations = new Set<string>();
  for (const action of intents.flatMap((intent) => intent.actions)) {
    if (!(action instanceof ContractCall)) throw new Error('Expected a contract call.');
    const circuitId =
      typeof action.entryPoint === 'string'
        ? action.entryPoint
        : new TextDecoder().decode(action.entryPoint);
    const verifierKeyHash = binding.circuits[circuitId]?.hashes?.verifierKey;
    if (!verifierKeyHash || !scope.circuits.includes(circuitId))
      throw new Error('Transaction circuit differs from the proof scope.');
    used.add(circuitId);
    locations.add(
      encodeContractKeyLocation({ contractAddress: action.address, circuitId, verifierKeyHash }),
    );
  }
  if (used.size !== scope.circuits.length)
    throw new Error('Transaction circuits differ from the request.');
  const checkLocation = (location: string) => {
    if (!locations.has(location)) throw new Error('Proving location differs from the binding.');
  };
  const proved = await tx.prove(
    {
      async lookupKey(location) {
        checkLocation(location);
        return provider.lookupKey(location);
      },
      async check(preimage, location) {
        checkLocation(location);
        return provider.check(preimage, location);
      },
      async prove(preimage, location, overwriteBindingInput) {
        checkLocation(location);
        return provider.prove(preimage, location, overwriteBindingInput);
      },
    },
    CostModel.initialCostModel(),
  );
  return proved.serialize();
}
