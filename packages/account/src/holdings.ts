import { PassportConnectorError } from './errors.js';
import type {
  AccountKeyring,
  AccountViewingKey,
  Authoriser,
  Chain,
  ShieldedCoin,
  VerifiedHoldingSource,
} from './ports/index.js';

export interface VerifiedHolding {
  /** Index of the ACC inbox entry that described this chain-confirmed coin. */
  readonly inboxIndex: number;
  readonly coin: ShieldedCoin;
}

export interface ReadVerifiedHoldingsInput {
  readonly account: string;
  /** Public key and sealed envelopes selected for this device from the live ACC ledger. */
  readonly keyring: AccountKeyring;
}

export interface ReadVerifiedHoldingsPorts {
  readonly networkId: string;
  readonly chain: Chain;
  readonly authoriser: Pick<Authoriser, 'withKeySession'>;
  readonly viewingKey: AccountViewingKey;
  /** Confirms opened descriptions against distinct chain outputs held by this ACC. */
  readonly holdings: VerifiedHoldingSource;
}

const same = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Read coin descriptions under one explicit Lace-compatible key session and return only entries
 * whose commitments a chain-backed source confirms as holdings of this ACC. The viewing secret
 * stays inside `viewingKey`; this flow receives opened descriptions, never raw key material.
 * The caller must select this device's sealed keyring from the live ledger before calling.
 */
export async function readVerifiedHoldings(
  input: ReadVerifiedHoldingsInput,
  ports: ReadVerifiedHoldingsPorts,
): Promise<readonly VerifiedHolding[]> {
  const { account, keyring } = input;
  if (keyring.account !== account)
    throw new PassportConnectorError('NotAuthorised', 'The keyring belongs to another account.');
  const ledger = await ports.chain.readAccount(account, { includeInbox: true });
  if (!ledger) throw new PassportConnectorError('AccountNotFound', `No ACC at ${account}.`);
  if (!ledger.encKey || !ledger.inboxEntries)
    throw new PassportConnectorError('BindingUnsupported', 'The chain port omits ACC inbox data.');
  if (!same(ledger.encKey, keyring.encKey))
    throw new PassportConnectorError('EncryptionKeyMismatch', 'The keyring is stale for this ACC.');
  const entries = ledger.inboxEntries;
  if (entries.length === 0) return [];
  if (!ports.authoriser.withKeySession)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'A read-holdings key session is required.',
    );

  return ports.authoriser.withKeySession(
    async () => {
      const opened = await ports.viewingKey.openInbox(ports.networkId, keyring, entries);
      if (opened.length !== entries.length)
        throw new PassportConnectorError(
          'InternalError',
          'The viewing key returned an incomplete inbox.',
        );
      const indices = await ports.holdings.selectHeldEntries(account, entries, opened);
      const seen = new Set<number>();
      const result: VerifiedHolding[] = [];
      for (const index of indices) {
        if (!Number.isSafeInteger(index) || index < 0 || index >= opened.length || seen.has(index))
          throw new PassportConnectorError(
            'InternalError',
            'The holding source returned an invalid index.',
          );
        seen.add(index);
        const entry = opened[index];
        if (entry?.kind !== 'coin')
          throw new PassportConnectorError(
            'InternalError',
            'The holding source selected a non-coin.',
          );
        result.push({ inboxIndex: index, coin: entry.coin });
      }
      return result;
    },
    { kind: 'read-holdings' },
  );
}
