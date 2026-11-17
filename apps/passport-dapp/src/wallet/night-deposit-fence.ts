import {
  openBrowserNightSendJournal,
  type BrowserNightSendScope,
} from '../midnames/night-send-journal.js';
import {
  checkedNightBridgeOutput,
  exactNightBridgeOutput,
  type NightBridgeOutput,
} from '../midnames/night-bridge-output.js';
import { readFinalizedNightLeg } from '../midnames/night-finality.js';
import type { NightSendLeg } from '../midnames/night-send.js';

function sameLeg(left: NightSendLeg | undefined, right: NightSendLeg): boolean {
  return (
    left?.hash === right.hash &&
    JSON.stringify(left.identifiers) === JSON.stringify(right.identifiers)
  );
}

function sameOutput(left: NightBridgeOutput, right: NightBridgeOutput): boolean {
  return (
    left.transactionHash === right.transactionHash &&
    left.intentHash === right.intentHash &&
    left.outputNo === right.outputNo &&
    left.owner === right.owner &&
    left.type === right.type &&
    left.value === right.value
  );
}

/** Derive the spendable coin from the journaled, finalized withdrawal in the worker. */
export async function journaledNightBridgeOutput(
  scope: BrowserNightSendScope,
  target: string,
  supplied: NightBridgeOutput,
  indexerUrl: string,
  nodeUrl: string,
  factory: IDBFactory = indexedDB,
  finalized: typeof readFinalizedNightLeg = readFinalizedNightLeg,
): Promise<NightBridgeOutput> {
  const proposed = checkedNightBridgeOutput(supplied);
  const journal = await openBrowserNightSendJournal(factory, scope);
  try {
    const row = await journal.readActive();
    if (
      !row?.withdrawal ||
      row.deposit ||
      row.intent.target !== target ||
      row.intent.bridge !== proposed.owner ||
      row.intent.amount !== proposed.value.toString() ||
      row.withdrawal.hash !== proposed.transactionHash
    )
      throw new Error('The NIGHT deposit does not match the active withdrawal journal.');
    const observed = await finalized(indexerUrl, nodeUrl, row.withdrawal);
    if (!observed) throw new Error('The original NIGHT withdrawal is not finalized.');
    const derived = exactNightBridgeOutput(row.intent, row.withdrawal, observed.transaction);
    if (!sameOutput(derived, proposed))
      throw new Error('The selected NIGHT coin does not come from the journaled withdrawal.');
    return derived;
  } finally {
    journal.close();
  }
}

/** The worker independently reads the strict IndexedDB fence before its only dispatch. */
export async function exactFencedNightDeposit(
  scope: BrowserNightSendScope,
  original: NightSendLeg,
  output: NightBridgeOutput,
  target: string,
  factory: IDBFactory = indexedDB,
): Promise<boolean> {
  const journal = await openBrowserNightSendJournal(factory, scope);
  try {
    const row = await journal.readActive();
    return (
      !!row &&
      row.intent.networkId === scope.networkId &&
      row.intent.source === scope.source &&
      row.credentialId === scope.credentialId &&
      row.intent.bridge === output.owner &&
      row.intent.target === target &&
      row.intent.amount === output.value.toString() &&
      row.withdrawal?.hash === output.transactionHash &&
      sameLeg(row.deposit, original)
    );
  } finally {
    journal.close();
  }
}
