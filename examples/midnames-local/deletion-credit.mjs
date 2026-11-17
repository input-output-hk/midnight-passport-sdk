/**
 * Rebuild a one-call standalone naming transaction before proving.
 *
 * The retained Compact 0.35 composer pads all four gas dimensions. Ledger 9
 * treats bytesDeleted as a credit: claiming more deletions than execution
 * produces rejects an otherwise valid call. Forgoing that credit is safe for
 * fees and leaves the program, effects, inputs and outputs unchanged.
 *
 * This is deliberately limited to the single-call local Midnames fixture.
 * Recompiled Compact 0.36 artifacts need their own deployed verifier keys.
 */
export function withoutDeletionCredit(result, state, networkId, ledger, types, registryAddress) {
  const original = result.private.unprovenTx;
  const intents = [...(original.intents?.values() ?? [])];
  const calls = result.calls;
  const circuit = String(calls[0]?.circuitId);
  if (
    intents.length !== 1 ||
    intents[0].actions.length !== 1 ||
    calls.length !== 1 ||
    String(calls[0].contractAddress) !== registryAddress ||
    !['create_domain', 'transfer_domain'].includes(circuit)
  )
    throw new Error('Deletion-credit adjustment requires one naming call.');
  const call = calls[0];
  const [guaranteed, fallible] = call.public.partitionedTranscript;
  if (!guaranteed || fallible || guaranteed.gas.bytesDeleted <= 0n)
    throw new Error('Unexpected naming transcript partition.');
  const existing = intents[0].actions[0];
  const entry =
    typeof existing.entryPoint === 'string'
      ? existing.entryPoint
      : new TextDecoder().decode(existing.entryPoint);
  if (existing.address !== registryAddress || entry !== circuit)
    throw new Error('The unproven transaction differs from the executed call.');

  const operation = ledger.ContractState.deserialize(state.serialize()).operation(circuit);
  const keyLocation = types.encodeContractKeyLocation({
    contractAddress: registryAddress,
    circuitId: circuit,
    verifierKeyHash: types.hashVerifierKey(operation.verifierKey),
  });
  const safeTranscript = {
    ...guaranteed,
    gas: { ...guaranteed.gas, bytesDeleted: 0n },
  };
  const prototype = new ledger.ContractCallPrototype(
    registryAddress,
    circuit,
    operation,
    safeTranscript,
    undefined,
    call.private.privateTranscriptOutputs,
    call.private.input,
    call.private.output,
    ledger.communicationCommitmentRandomness(),
    keyLocation,
  );
  const oldIntent = intents[0];
  let intent = ledger.Intent.new(oldIntent.ttl);
  intent = intent.addCall(prototype);
  intent.guaranteedUnshieldedOffer = oldIntent.guaranteedUnshieldedOffer;
  intent.fallibleUnshieldedOffer = oldIntent.fallibleUnshieldedOffer;
  const adjusted = ledger.Transaction.fromPartsRandomized(
    networkId,
    original.guaranteedOffer,
    original.fallibleOffer,
    intent,
  );
  const [adjustedCall] = [...adjusted.intents.values()].flatMap((part) => part.actions);
  if (
    adjustedCall?.guaranteedTranscript?.gas.bytesDeleted !== 0n ||
    adjustedCall.guaranteedTranscript.program.length !== guaranteed.program.length
  )
    throw new Error('Deletion-credit adjustment did not preserve the call.');
  return adjusted;
}
