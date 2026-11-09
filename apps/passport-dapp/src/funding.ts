export interface DemoFundingAsset {
  readonly color: string;
  readonly amount: string;
  readonly availability: 'available' | 'insufficient' | 'unavailable';
}

export function canFund(busy: boolean, accountOpen: boolean, asset: DemoFundingAsset | undefined) {
  return !busy && accountOpen && asset?.availability === 'available';
}

export function fundingDescription(asset: DemoFundingAsset | undefined): string {
  return canFund(false, true, asset)
    ? 'Deposit the selected asset from the demo funding wallet into this account.'
    : 'Deposits are unavailable. The funding wallet needs a synchronized balance of the selected asset.';
}

/** A balance refresh must not silently change the user's selected deposit asset. */
export function preferredFundingAsset(assets: readonly DemoFundingAsset[], previous: string) {
  if (previous) return assets.find((asset) => asset.color === previous);
  return (
    assets.find((asset) => asset.color === '00'.repeat(32) && asset.availability === 'available') ??
    assets.find((asset) => asset.availability === 'available') ??
    assets.find((asset) => asset.color === '00'.repeat(32)) ??
    assets[0]
  );
}

export function fundingRequestFailure(input: {
  readonly status: number;
  readonly result: unknown;
  readonly requestId: string;
  readonly storage: Pick<Storage, 'getItem' | 'removeItem'>;
  readonly keys: readonly string[];
  readonly onNotStarted: (details: { requestId: string; code: string }) => void;
}) {
  const failure = fundingFailure(input.status, input.result, input.requestId);
  if (failure.notStarted) {
    for (const key of input.keys) {
      if (input.storage.getItem(key) === input.requestId) input.storage.removeItem(key);
    }
    input.onNotStarted({ requestId: input.requestId, code: failure.error.name });
  }
  return failure.error;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export function fundingUnsettled(message: string) {
  const error = new Error(message);
  error.name = 'FundingRejected';
  return error;
}

/** Sending/reading a response can fail after submission; neither failure proves no transfer. */
export async function fundingExchange(
  send: () => Promise<{
    readonly ok: boolean;
    readonly status: number;
    json(): Promise<unknown>;
  }>,
) {
  try {
    const response = await send();
    const result: unknown = await response.json();
    if (!object(result)) throw new Error('Invalid funding response');
    return { response, result };
  } catch {
    throw fundingUnsettled(
      'Funding confirmation is unavailable. Reconcile the original request ID.',
    );
  }
}

/** The policy list remains usable for balances/withdrawals when funding inventory is unavailable. */
export function parseFundingDiscovery(value: unknown) {
  if (
    !object(value) ||
    !Array.isArray(value.assets) ||
    !value.assets.length ||
    value.assets.length > 64
  )
    throw new Error('Invalid funding discovery');
  const assets = value.assets.map((raw: unknown): DemoFundingAsset => {
    if (
      !object(raw) ||
      typeof raw.color !== 'string' ||
      !/^[0-9a-f]{64}$/.test(raw.color) ||
      typeof raw.amount !== 'string' ||
      !/^[1-9][0-9]{0,38}$/.test(raw.amount) ||
      BigInt(raw.amount) > (1n << 128n) - 1n
    )
      throw new Error('Invalid funding asset');
    return {
      color: raw.color,
      amount: raw.amount,
      availability:
        raw.availability === 'available' || raw.availability === 'insufficient'
          ? raw.availability
          : 'unavailable',
    };
  });
  if (
    new Set(assets.map((asset) => asset.color)).size !== assets.length ||
    typeof value.balanceAssetColor !== 'string' ||
    !assets.some((asset) => asset.color === value.balanceAssetColor)
  )
    throw new Error('Invalid funding balance asset');
  return { assets, balanceAssetColor: value.balanceAssetColor };
}

/** A refusal may clear only this exact original ID, after the server durably tombstones it. */
export function fundingFailure(status: number, value: unknown, requestId: string) {
  const body = object(value) ? value : {};
  const notStarted =
    [409, 503].includes(status) &&
    body.requestId === requestId &&
    body.submission === 'not-started' &&
    !('txId' in body) &&
    !('preparationTxId' in body) &&
    typeof body.code === 'string' &&
    ['FundingAssetUnavailable', 'FundingWalletUnavailable'].includes(body.code);
  const error = new Error(
    notStarted
      ? body.code === 'FundingAssetUnavailable'
        ? 'The funding wallet does not hold enough of this asset. No transfer was started.'
        : 'The funding wallet is not ready. No transfer was started.'
      : typeof body.error === 'string'
        ? body.error
        : 'Funding was refused',
  );
  error.name = notStarted ? String(body.code) : 'FundingRejected';
  return { error, notStarted };
}
