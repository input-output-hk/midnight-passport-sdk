import { readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ClaimReceipt } from '../../apps/passport-dapp/src/midnames/claim-receipt.ts';
import { claimReceiptLimit } from '../../apps/passport-dapp/src/midnames/claim-receipt.ts';
import { openClaimDispatch, readClaimRecord } from './claim-dispatch.mts';

const activeJournal =
  /^claim-journal(?:$|-candidate$|-(?:stable|candidate)-[a-z0-9][a-z0-9-]{0,39}$)/;
const journalLimit = 128;

/** A new local claim must not bypass another journal's unknown original. */
export async function assertOtherClaimJournalsSettled(
  selected: string,
  confirmed: (receipt: ClaimReceipt) => Promise<boolean>,
): Promise<number> {
  const parent = dirname(selected);
  const others = readdirSync(parent, { withFileTypes: true })
    .filter((entry) => activeJournal.test(entry.name) && entry.name !== basename(selected))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (others.length > journalLimit) throw new Error('Too many local claim journals to check.');
  for (const entry of others) {
    if (!entry.isDirectory()) throw new Error('A local claim journal is not a directory.');
    const path = join(parent, entry.name);
    const journal = openClaimDispatch(path);
    const receipt = journal.preparedReceipt();
    const intent = readClaimRecord(join(path, 'claim-prepare-intent.json'), claimReceiptLimit);
    if (!receipt) {
      if (intent !== undefined || journal.hasAnyFence())
        throw new Error(`Resolve the original in ${entry.name} before selecting another journal.`);
      continue;
    }
    if (!journal.hasFence(receipt) || !(await confirmed(receipt)))
      throw new Error(`Resolve the original in ${entry.name} before selecting another journal.`);
  }
  return others.length;
}
