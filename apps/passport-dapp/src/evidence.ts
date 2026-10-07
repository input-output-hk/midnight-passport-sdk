// The evidence the Copy button puts on the clipboard: a header, the account, the wallet and the
// event log's rows, as JSON. Apart from the DOM so a test can build one from fixed inputs. Only
// public values go in: the account and wallet views hold addresses, counters and balances, and
// the runs are `EventLog.toJSON()`; nothing here ever receives a seed, a key or a PRF output.
import type { AccountView, EvidenceHeader, WalletView } from './ui.js';

export interface EvidenceParts {
  readonly header: EvidenceHeader;
  /** The page's origin. */
  readonly page: string;
  readonly account: AccountView | undefined;
  readonly wallet: WalletView;
  /** `EventLog.toJSON()`. */
  readonly runs: unknown[];
}

export const buildEvidence = ({ header, page, account, wallet, runs }: EvidenceParts) => ({
  ...header,
  page,
  account: account && {
    address: account.address,
    networkId: account.networkId,
    bindingId: account.bindingId,
    state: account.state,
    lastTx: account.lastTx,
  },
  wallet: Object.keys(wallet).length > 0 ? wallet : undefined,
  runs,
});

const jsonReplacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

/** The text shown and copied: bigints (counters, balances) as decimal strings. */
export const evidenceJson = (parts: EvidenceParts): string =>
  JSON.stringify(buildEvidence(parts), jsonReplacer, 2);
