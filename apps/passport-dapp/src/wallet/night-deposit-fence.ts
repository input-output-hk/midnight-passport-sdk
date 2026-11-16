import {
  openBrowserNightSendJournal,
  type BrowserNightSendScope,
} from '../midnames/night-send-journal.js';
import type { NightBridgeOutput } from '../midnames/night-bridge-output.js';
import type { NightSendLeg } from '../midnames/night-send.js';

function sameLeg(left: NightSendLeg | undefined, right: NightSendLeg): boolean {
  return (
    left?.hash === right.hash &&
    JSON.stringify(left.identifiers) === JSON.stringify(right.identifiers)
  );
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
