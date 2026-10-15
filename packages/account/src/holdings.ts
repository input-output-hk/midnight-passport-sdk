import { PassportConnectorError } from './errors.js';
import type {
  AccountKeyring,
  AccountViewingKey,
  Authoriser,
  Chain,
  QualifiedHoldingSource,
  QualifiedShieldedCoin,
  ShieldedCoin,
  VerifiedHoldingSource,
} from './ports/index.js';

export interface VerifiedHolding {
  /** Index of the ACC inbox entry that described this chain-confirmed coin. */
  readonly inboxIndex: number;
  readonly coin: ShieldedCoin;
}

/** Select one chain-matched qualified coin inside the caller's owner key session. */
export async function readQualifiedHolding(
  input: ReadVerifiedHoldingsInput & { readonly inboxIndex: number; readonly color: Uint8Array },
  ports: {
    readonly networkId: string;
    readonly chain: {
      readAccount(
        address: string,
        options: { readonly includeInbox: true },
      ): Promise<
        { readonly encKey?: Uint8Array; readonly inboxEntries?: readonly Uint8Array[] } | undefined
      >;
    };
    readonly viewingKey: Pick<AccountViewingKey, 'openInbox'>;
    readonly holdings: QualifiedHoldingSource;
  },
): Promise<QualifiedShieldedCoin> {
  const { account, keyring, inboxIndex, color } = input;
  if (keyring.account !== account)
    throw new PassportConnectorError('NotAuthorised', 'The keyring belongs to another account.');
  if (!Number.isSafeInteger(inboxIndex) || inboxIndex < 0)
    throw new PassportConnectorError('TransferInvalid', 'Invalid shielded inbox index.');
  const ledger = await ports.chain.readAccount(account, { includeInbox: true });
  if (!ledger) throw new PassportConnectorError('AccountNotFound', `No ACC at ${account}.`);
  if (!ledger.encKey || !ledger.inboxEntries)
    throw new PassportConnectorError('BindingUnsupported', 'The chain port omits ACC inbox data.');
  if (!same(ledger.encKey, keyring.encKey))
    throw new PassportConnectorError('EncryptionKeyMismatch', 'The keyring is stale for this ACC.');
  const entries = ledger.inboxEntries;
  if (inboxIndex >= entries.length)
    throw new PassportConnectorError('TransferInvalid', 'The selected inbox entry is missing.');
  const opened = await ports.viewingKey.openInbox(ports.networkId, keyring, entries);
  if (opened.length !== entries.length)
    throw new PassportConnectorError(
      'InternalError',
      'The viewing key returned an incomplete inbox.',
    );
  const candidates = await ports.holdings.selectQualifiedHeldCoins(account, entries, opened);
  const selected = candidates.filter((candidate) => candidate.inboxIndex === inboxIndex);
  if (selected.length !== 1)
    throw new PassportConnectorError(
      'TransferInvalid',
      'The selected coin is not a unique ACC output.',
    );
  const openedCoin = opened[inboxIndex];
  const coin = selected[0]!.coin;
  if (
    openedCoin?.kind !== 'coin' ||
    !same(openedCoin.coin.nonce, coin.nonce) ||
    !same(openedCoin.coin.color, coin.color) ||
    openedCoin.coin.value !== coin.value ||
    !same(color, coin.color)
  )
    throw new PassportConnectorError(
      'TransferInvalid',
      'The selected coin does not match the transfer.',
    );
  if (
    coin.nonce.length !== 32 ||
    coin.color.length !== 32 ||
    coin.value < 0n ||
    coin.value >= 1n << 128n ||
    typeof coin.mt_index !== 'bigint' ||
    coin.mt_index < 0n ||
    coin.mt_index >= 1n << 64n
  )
    throw new PassportConnectorError('TransferInvalid', 'The qualified coin is malformed.');
  return {
    nonce: coin.nonce.slice(),
    color: coin.color.slice(),
    value: coin.value,
    mt_index: coin.mt_index,
  };
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
