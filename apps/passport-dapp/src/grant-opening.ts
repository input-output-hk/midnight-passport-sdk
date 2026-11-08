import { grantHandoffFromOpening } from './grant-handoff.js';
import type { browserGrantJournal } from './grant-journal.js';
import type { createMidnightGrantSource } from '@input-output-hk/mn-passport-adapter-midnight-js';

export async function exportGrantOpening(
  journal: ReturnType<typeof browserGrantJournal> | undefined,
  readSource: () => Promise<ReturnType<typeof createMidnightGrantSource>>,
  networkId: string,
  pure: () => Promise<Parameters<typeof grantHandoffFromOpening>[4]>,
  account: string,
  grantId: string,
) {
  if (!journal) throw new Error('The owner grant journal is unavailable.');
  const staged = await journal.load(account, grantId);
  if (!staged) throw new Error('This browser has no sealed opening for the grant.');
  const source = await readSource();
  const [live, context] = await Promise.all([
    source.readGrantCommitment(account, grantId),
    source.readGrantSpendContext(account, grantId),
  ]);
  return grantHandoffFromOpening(staged, live, context, networkId, await pure());
}
