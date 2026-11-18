/**
 * Rebuild a one-call standalone naming transaction before proving.
 *
 * The retained Compact 0.35 composer pads all four gas dimensions. Ledger 9
 * treats bytesDeleted as a credit: claiming more deletions than execution
 * produces, rejecting an otherwise valid call. Forgoing that credit is safe for
 * fees and leaves the program, effects, inputs and outputs unchanged.
 *
 * This is deliberately limited to single-call local naming and named-ACC
 * shielded deposit fixtures. ACC NIGHT funding needs its measured credit;
 * removing all of it exhausts that call's budget. A rebuilt call must be
 * proved and balanced again.
 * Recompiled Compact 0.36 artifacts need their own deployed verifier keys.
 */
function rebuildWithCredit(
  result,
  state,
  networkId,
  ledger,
  types,
  contractAddress,
  credit,
  allowed,
) {
  const original = result.private.unprovenTx;
  const intents = [...(original.intents?.values() ?? [])];
  const calls = result.calls;
  const circuit = String(calls[0]?.circuitId);
  if (
    intents.length !== 1 ||
    intents[0].actions.length !== 1 ||
    calls.length !== 1 ||
    String(calls[0].contractAddress) !== contractAddress ||
    !allowed.includes(circuit)
  )
    throw new Error('Deletion-credit adjustment requires one supported call.');
  const call = calls[0];
  const [guaranteed, fallible] = call.public.partitionedTranscript;
  if (!!guaranteed === !!fallible) throw new Error('Unexpected call transcript partition.');
  const transcript = guaranteed ?? fallible;
  if (transcript.gas.bytesDeleted <= 0n)
    throw new Error('The call transcript has no deletion credit to remove.');
  const existing = intents[0].actions[0];
  const entry =
    typeof existing.entryPoint === 'string'
      ? existing.entryPoint
      : new TextDecoder().decode(existing.entryPoint);
  if (existing.address !== contractAddress || entry !== circuit)
    throw new Error('The unproven transaction differs from the executed call.');

  const operation = ledger.ContractState.deserialize(state.serialize()).operation(circuit);
  const keyLocation = types.encodeContractKeyLocation({
    contractAddress,
    circuitId: circuit,
    verifierKeyHash: types.hashVerifierKey(operation.verifierKey),
  });
  const safeTranscript = {
    ...transcript,
    gas: { ...transcript.gas, bytesDeleted: credit },
  };
  const prototype = new ledger.ContractCallPrototype(
    contractAddress,
    circuit,
    operation,
    guaranteed && safeTranscript,
    fallible && safeTranscript,
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
  const adjustedTranscript = guaranteed
    ? adjustedCall?.guaranteedTranscript
    : adjustedCall?.fallibleTranscript;
  if (
    adjustedTranscript?.gas.bytesDeleted !== credit ||
    adjustedTranscript.program.length !== transcript.program.length
  )
    throw new Error('Deletion-credit adjustment did not preserve the call.');
  return adjusted;
}

export function withoutDeletionCredit(result, state, networkId, ledger, types, contractAddress) {
  return rebuildWithCredit(result, state, networkId, ledger, types, contractAddress, 0n, [
    'create_domain',
    'transfer_domain',
    'deposit_shielded',
  ]);
}

/** Keep exactly the deleted-byte credit this pinned ACC call earns on the observed state. */
export function withMeasuredDeletionCredit(
  result,
  state,
  parameters,
  networkId,
  ledger,
  types,
  contractAddress,
) {
  const [call] = result.calls;
  const [guaranteed, fallible] = call?.public.partitionedTranscript ?? [];
  if (
    result.calls.length !== 1 ||
    String(call?.circuitId) !== 'deposit_unshielded' ||
    !guaranteed ||
    fallible
  )
    throw new Error('Measured deletion credit requires one guaranteed ACC NIGHT deposit.');
  const data = ledger.ContractState.deserialize(state.serialize()).data;
  const model = parameters.transactionCostModel.runtimeCostModel;
  const context = () => new ledger.QueryContext(data, contractAddress);
  const gather = guaranteed.program.map((part) =>
    typeof part === 'object' && 'popeq' in part ? { popeq: { ...part.popeq, result: null } } : part,
  );
  const credit = context().query(gather, model).gasCost.bytesDeleted;
  if (credit <= 0n || credit > guaranteed.gas.bytesDeleted)
    throw new Error('The measured ACC deletion credit is outside the declared budget.');
  context().runTranscript(
    { ...guaranteed, gas: { ...guaranteed.gas, bytesDeleted: credit } },
    model,
  );
  return rebuildWithCredit(result, state, networkId, ledger, types, contractAddress, credit, [
    'deposit_unshielded',
  ]);
}
