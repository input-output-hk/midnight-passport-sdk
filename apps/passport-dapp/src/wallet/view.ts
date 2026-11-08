export interface WalletView {
  readonly unshieldedAddress?: string;
  readonly shieldedAddress?: string;
  readonly dustAddress?: string;
  readonly unshieldedBalances?: Readonly<Record<string, bigint>> | undefined;
  readonly dust?: { readonly balance: bigint; readonly cap: bigint } | undefined;
  readonly dustStatus?: 'syncing' | 'ready' | 'unavailable' | undefined;
  readonly dustUpdatedAt?: string | undefined;
  readonly balanceError?: string | undefined;
  readonly balanceUpdatedAt?: string | undefined;
}
export interface WalletFact {
  label: string;
  value: string;
  full?: string;
  copy?: string;
  hint?: string;
}
const shorten = (value: string, head: number, tail: number) =>
  value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
const amount = (value: bigint) => value.toLocaleString('en-GB');

/** Pure presentation data; no DOM, commands, wallet SDK or key material. */
export function walletFacts(wallet: WalletView): readonly WalletFact[] {
  const facts: WalletFact[] = [];
  const address = (label: string, value: string | undefined) => {
    if (value) facts.push({ label, value: shorten(value, 14, 8), full: value, copy: value });
  };
  address('Unshielded address', wallet.unshieldedAddress);
  address('Shielded address', wallet.shieldedAddress);
  address('Dust address', wallet.dustAddress);
  if (wallet.unshieldedBalances) {
    const entries = Object.entries(wallet.unshieldedBalances);
    if (!entries.some(([token]) => /^0+$/.test(token)))
      facts.push({ label: 'NIGHT (built-in wallet)', value: '0', hint: 'Smallest unit.' });
    for (const [token, value] of entries)
      facts.push({
        label: /^0+$/.test(token) ? 'NIGHT (built-in wallet)' : `Token ${shorten(token, 6, 4)}`,
        value: amount(value),
        full: token,
        hint: 'Smallest unit.',
      });
  } else
    facts.push(
      wallet.balanceError
        ? { label: 'Balances', value: 'Not read', hint: wallet.balanceError }
        : { label: 'Balances', value: 'Waiting for NIGHT to sync…' },
    );
  if (wallet.dust)
    facts.push({
      label: 'DUST',
      value: `${amount(wallet.dust.balance)} of ${amount(wallet.dust.cap)}`,
      hint: 'Balance of cap, in Specks.',
    });
  else if (wallet.dustStatus)
    facts.push({
      label: 'DUST',
      value: wallet.dustStatus === 'syncing' ? 'Syncing independently…' : 'Unavailable',
      hint: 'NIGHT and other actions do not wait for DUST. Refresh to retry.',
    });
  if (wallet.balanceUpdatedAt)
    facts.push({
      label: 'Balances updated',
      value: wallet.balanceUpdatedAt,
      hint: 'Local NIGHT read time (UTC), not chain confirmation time. Refresh after receiving funds.',
    });
  if (wallet.dustUpdatedAt)
    facts.push({
      label: 'DUST updated',
      value: wallet.dustUpdatedAt,
      hint: 'Independent local read time (UTC).',
    });
  return facts;
}
