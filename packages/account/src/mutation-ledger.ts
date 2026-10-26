import { mutationDigest, mutationFailure } from './mutation-codec.js';
import { toHex } from './codec.js';
import type {
  AccBinding,
  AccLedgerView,
  CallRequest,
  CurvePoint,
  WebAuthnPolicy,
} from './ports/index.js';
import type { MutationLedger } from './mutation-types.js';

export function mutationLedger(view: AccLedgerView | undefined): MutationLedger {
  if (
    !view ||
    typeof view.booted !== 'boolean' ||
    typeof view.authNonce !== 'bigint' ||
    view.authNonce < 0n ||
    view.authNonce >= 1n << 64n ||
    typeof view.deviceEpoch !== 'bigint' ||
    view.deviceEpoch < 0n ||
    view.deviceEpoch >= 1n << 64n ||
    !view.encKey ||
    view.encKey.length !== 32 ||
    !view.inboxEntries ||
    !view.deviceEntries ||
    view.entryCount !== view.deviceEntries.length ||
    view.inboxEntries.length > 4096 ||
    view.deviceEntries.length > 64 ||
    view.specVersion !== 3
  )
    return mutationFailure('Durability requires a complete bounded spec-3 ACC ledger snapshot.');
  const snapshot = {
    booted: view.booted,
    authNonce: view.authNonce,
    deviceEpoch: view.deviceEpoch,
    specVersion: view.specVersion,
    encKey: view.encKey.slice(),
    entryCount: view.entryCount,
    inboxEntries: view.inboxEntries.map((entry) => entry.slice()),
    deviceEntries: view.deviceEntries
      .map((entry) => entry.slice())
      .sort((a, b) => toHex(a).localeCompare(toHex(b))),
  };
  if (
    snapshot.deviceEntries.some((entry) => entry.length !== 32) ||
    snapshot.inboxEntries.some((entry) => entry.length !== 192) ||
    new Set(snapshot.deviceEntries.map(toHex)).size !== snapshot.entryCount
  )
    return mutationFailure('Invalid or ambiguous durable ledger snapshot.');
  return snapshot;
}
export function mutationView(snapshot: MutationLedger): AccLedgerView {
  return {
    ...snapshot,
    hasEntry: (entry) => snapshot.deviceEntries.some((held) => toHex(held) === toHex(entry)),
  };
}
export const sameMutationLedger = (a: MutationLedger, b: MutationLedger): boolean =>
  mutationDigest(a) === mutationDigest(b);

/** Only supported owner mutations. No value-bearing call or private witness enters the journal. */
export function predictMutationLedger(
  before: MutationLedger,
  request: CallRequest,
  binding: AccBinding,
): MutationLedger {
  const match =
    /^(activate_initial_device|append_inbox|rotate_enc_key|add_device|remove_device)_with_(p256|jubjub)$/.exec(
      request.circuit,
    );
  if (!match || request.heldCoin)
    return mutationFailure('This circuit is outside durable owner mutation scope.');
  const op = match[1]!,
    arm = match[2]!,
    args = request.args;
  const pure = binding.pureCircuits;
  let pk: CurvePoint,
    policy: WebAuthnPolicy | undefined,
    counter = 0n;
  if (op === 'activate_initial_device') {
    if (before.booted) return mutationFailure('Activation baseline is already booted.');
    pk = args[0] as CurvePoint;
    policy = arm === 'p256' ? (args[2] as WebAuthnPolicy) : undefined;
  } else if (arm === 'p256') {
    const auth = args[1] as { pk: CurvePoint; policy: WebAuthnPolicy; use_counter: bigint };
    if (!auth) return mutationFailure('Missing P-256 mutation authorisation.');
    ({ pk, policy } = auth);
    counter = auth.use_counter;
  } else {
    pk = args[1] as CurvePoint;
    counter = args[2] as bigint;
  }
  if (typeof counter !== 'bigint' || counter < 0n || counter >= (1n << 64n) - 1n)
    return mutationFailure('Unsupported mutation counter.');
  const derive = (n: bigint): Uint8Array => {
    if (arm === 'p256') {
      if (!policy) return mutationFailure('Missing P-256 mutation policy.');
      return pure.derive_device_entry_with_p256(
        { bytes: Uint8Array.from(BufferlessHex(request.address)) },
        { ...pk, identity: false },
        policy,
        before.deviceEpoch,
        n,
      );
    }
    if (!pure.derive_device_entry_with_jubjub) return mutationFailure('Missing JubJub derivation.');
    return pure.derive_device_entry_with_jubjub(
      { bytes: Uint8Array.from(BufferlessHex(request.address)) },
      pk,
      before.deviceEpoch,
      n,
    );
  };
  const entries = new Map(before.deviceEntries.map((entry) => [toHex(entry), entry]));
  if (op !== 'activate_initial_device') {
    if (!before.booted || !entries.delete(toHex(derive(counter))))
      return mutationFailure('The signing entry is absent from the durable baseline.');
  }
  entries.set(
    toHex(derive(op === 'activate_initial_device' ? 0n : counter + 1n)),
    derive(op === 'activate_initial_device' ? 0n : counter + 1n),
  );
  const argument = args[0];
  if (op === 'add_device' || op === 'remove_device') {
    if (!(argument instanceof Uint8Array) || argument.length !== 32)
      return mutationFailure('Invalid durable device commitment.');
    if (op === 'add_device') entries.set(toHex(argument), argument.slice());
    else if (!entries.delete(toHex(argument)))
      return mutationFailure('Removal target is absent from the baseline.');
  }
  if (op === 'append_inbox' && (!(argument instanceof Uint8Array) || argument.length !== 192))
    return mutationFailure('Invalid durable sealed inbox entry.');
  if (op === 'rotate_enc_key' && (!(argument instanceof Uint8Array) || argument.length !== 32))
    return mutationFailure('Invalid durable encryption key.');
  return mutationLedger({
    ...before,
    booted: true,
    authNonce: before.authNonce + (op === 'activate_initial_device' ? 0n : 1n),
    encKey: op === 'rotate_enc_key' ? (argument as Uint8Array) : before.encKey,
    inboxEntries:
      op === 'append_inbox'
        ? [...before.inboxEntries, argument as Uint8Array]
        : before.inboxEntries,
    deviceEntries: [...entries.values()],
    entryCount: entries.size,
    hasEntry: () => false,
  });
}
const BufferlessHex = (value: string): number[] => {
  if (!/^[0-9a-f]{64}$/.test(value)) return mutationFailure('Invalid durable account address.');
  return Array.from({ length: 32 }, (_, i) => Number.parseInt(value.slice(i * 2, i * 2 + 2), 16));
};
