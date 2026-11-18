import type { NightSendIntent, NightSendLeg } from './night-send.js';

const HEX = /^[a-f0-9]{64}$/;
const NIGHT = '00'.repeat(32);

interface LedgerCoin {
  readonly value: bigint;
  readonly type: string;
  readonly owner: unknown;
  readonly intentHash: string;
  readonly outputNo: number;
}

interface LedgerOffer {
  readonly outputs: readonly {
    readonly value: bigint;
    readonly type: string;
    readonly owner: string;
  }[];
  readonly inputs: readonly LedgerCoin[];
}

/** Only the fields used by the pinned Ledger 9 transaction guard. */
export interface NightBridgeTransaction {
  transactionHash(): string;
  identifiers(): string[];
  readonly intents:
    | ReadonlyMap<
        number,
        {
          intentHash(segment: number): string;
          readonly actions?: readonly unknown[];
          readonly guaranteedUnshieldedOffer?: LedgerOffer;
          readonly fallibleUnshieldedOffer?: LedgerOffer;
        }
      >
    | undefined;
  readonly rewards?: unknown;
  readonly guaranteedOffer?: unknown;
  readonly fallibleOffer?: ReadonlyMap<unknown, unknown>;
}

export interface NightBridgeOutput {
  readonly transactionHash: string;
  readonly intentHash: string;
  readonly outputNo: number;
  readonly owner: string;
  readonly type: string;
  readonly value: bigint;
}

/** Parse a page-to-wallet-worker observation request without trusting its TypeScript shape. */
export function checkedNightBridgeOutput(value: unknown): NightBridgeOutput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid NIGHT bridge output.');
  const output = value as Record<string, unknown>;
  if (
    typeof output.transactionHash !== 'string' ||
    !HEX.test(output.transactionHash) ||
    typeof output.intentHash !== 'string' ||
    !HEX.test(output.intentHash) ||
    typeof output.outputNo !== 'number' ||
    !Number.isSafeInteger(output.outputNo) ||
    output.outputNo < 0 ||
    output.outputNo > 65_535 ||
    typeof output.owner !== 'string' ||
    !HEX.test(output.owner) ||
    output.type !== NIGHT ||
    typeof output.value !== 'bigint' ||
    output.value <= 0n ||
    output.value >= 1n << 128n
  )
    throw new Error('Invalid NIGHT bridge output.');
  return Object.freeze({
    transactionHash: output.transactionHash,
    intentHash: output.intentHash,
    outputNo: output.outputNo,
    owner: output.owner,
    type: NIGHT,
    value: output.value,
  });
}

function offers(tx: NightBridgeTransaction) {
  return [...(tx.intents ?? [])].flatMap(([segment, intent]) =>
    [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer]
      .filter((offer): offer is LedgerOffer => offer !== undefined)
      .map((offer) => ({ offer, intentHash: intent.intentHash(segment) })),
  );
}

/** Decode the already-fenced withdrawal, never a replacement wallet balance. */
export function exactNightBridgeOutput(
  intent: NightSendIntent,
  withdrawal: NightSendLeg,
  transaction: NightBridgeTransaction,
): NightBridgeOutput {
  const identifiers = transaction.identifiers();
  if (
    intent.networkId !== 'undeployed' ||
    intent.asset !== 'NIGHT' ||
    !HEX.test(intent.bridge) ||
    !/^[1-9][0-9]{0,38}$/.test(intent.amount) ||
    BigInt(intent.amount) >= 1n << 128n ||
    !HEX.test(withdrawal.hash) ||
    transaction.transactionHash() !== withdrawal.hash ||
    !Array.isArray(withdrawal.identifiers) ||
    withdrawal.identifiers.length === 0 ||
    withdrawal.identifiers.length !== identifiers.length ||
    withdrawal.identifiers.some(
      (id, index) => !/^[a-f0-9]{66}$/.test(id) || id !== identifiers[index],
    )
  )
    throw new Error('The original NIGHT withdrawal identity differs from the journal.');

  const outputs = offers(transaction).flatMap(({ offer, intentHash }) =>
    offer.outputs.map((output, outputNo) => ({ ...output, outputNo, intentHash })),
  );
  const [output] = outputs;
  if (
    outputs.length !== 1 ||
    !output ||
    !HEX.test(output.intentHash) ||
    output.owner !== intent.bridge ||
    output.type !== NIGHT ||
    output.value !== BigInt(intent.amount)
  )
    throw new Error('The original withdrawal has no single exact controlled NIGHT output.');
  return Object.freeze({
    transactionHash: withdrawal.hash,
    intentHash: output.intentHash,
    outputNo: output.outputNo,
    owner: intent.bridge,
    type: NIGHT,
    value: output.value,
  });
}

/** A wallet observation is advisory; it does not constrain the wallet's coin selection. */
export function hasExactNightBridgeCoin(
  available: readonly { readonly utxo: LedgerCoin }[],
  expected: NightBridgeOutput,
  encodedOwner?: string,
): boolean {
  const owner = (value: unknown) => {
    if (typeof value === 'string' && HEX.test(value)) return value;
    if (
      value &&
      typeof value === 'object' &&
      'hexString' in value &&
      typeof value.hexString === 'string' &&
      HEX.test(value.hexString)
    )
      return value.hexString;
    return String(value);
  };
  const matches = available.filter(
    ({ utxo }) =>
      utxo.intentHash === expected.intentHash &&
      utxo.outputNo === expected.outputNo &&
      utxo.value === expected.value &&
      utxo.type === expected.type &&
      (owner(utxo.owner) === expected.owner ||
        (encodedOwner !== undefined && owner(utxo.owner) === encodedOwner)),
  );
  if (matches.length > 1) throw new Error('Ambiguous original NIGHT wallet output.');
  return matches.length === 1;
}

/** Inspect the *balanced* target deposit before allowing its journal fence or dispatch. */
export function assertExactNightBridgeSpend(
  transaction: NightBridgeTransaction,
  expected: NightBridgeOutput,
  addressFromKey: (owner: unknown) => string,
): void {
  const inputs = offers(transaction).flatMap(({ offer }) => offer.inputs);
  const [input] = inputs;
  if (
    inputs.length !== 1 ||
    !input ||
    input.intentHash !== expected.intentHash ||
    input.outputNo !== expected.outputNo ||
    input.value !== expected.value ||
    input.type !== expected.type ||
    addressFromKey(input.owner) !== expected.owner
  )
    throw new Error('The deposit must consume only the original controlled NIGHT output.');
}
