export interface DemoFundingAsset {
  readonly color: string;
  readonly amount: string;
  readonly availability: 'available' | 'insufficient' | 'unavailable';
}

export function fundingStorageKeys(network: string, accountAddress: string, color: string) {
  return {
    current: `passport-demo:fund:${network}:${accountAddress}:${color}`,
    legacy: `passport-demo:fund:${network}:${accountAddress}`,
  };
}

export function storedFundingOriginal(
  storage: Pick<Storage, 'getItem'>,
  network: string,
  accountAddress: string,
  color: string,
) {
  const keys = fundingStorageKeys(network, accountAddress, color);
  return (
    storage.getItem(keys.current) ??
    (color === '00'.repeat(32) ? null : storage.getItem(keys.legacy))
  );
}

/** Saved IDs remain visible even when discovery fails after a browser reload. */
export function savedFundingAssets(
  storage: Pick<Storage, 'length' | 'key' | 'getItem'>,
  network: string,
  accountAddress: string,
): DemoFundingAsset[] {
  const prefix = `passport-demo:fund:${network}:${accountAddress}:`;
  const colors = new Set<string>();
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const color = key.slice(prefix.length);
    if (
      /^[0-9a-f]{64}$/.test(color) &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        storage.getItem(key) ?? '',
      )
    )
      colors.add(color);
  }
  return [...colors].map((color) => ({ color, amount: '0', availability: 'unavailable' }));
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
  readonly onReconciled?: (details: { requestId: string; code: string }) => void;
}) {
  const failure = fundingFailure(input.status, input.result, input.requestId);
  if (failure.notStarted || failure.released) {
    for (const key of input.keys) {
      if (input.storage.getItem(key) === input.requestId) input.storage.removeItem(key);
    }
    if (failure.notStarted)
      input.onNotStarted({ requestId: input.requestId, code: failure.error.name });
    else input.onReconciled?.({ requestId: input.requestId, code: failure.error.name });
  }
  return failure.error;
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export interface FundingOriginalIdentity {
  readonly requestId: string;
  readonly accountAddress: string;
  readonly color: string;
  readonly amount?: string;
}

export interface FundingOriginalStatus {
  readonly state: 'pending' | 'complete' | 'released';
  readonly amount: string;
  readonly result?: Record<string, unknown>;
  readonly progress?: Record<string, unknown>;
}

/** The phase is an observation of the same original, never permission to retry it. */
export function fundingProgressMessage(progress: FundingOriginalStatus['progress']): string {
  switch (progress?.phase) {
    case 'wallet-preparation':
      return 'Preparing the funding wallet transaction…';
    case 'wallet-prepared':
      return 'Funding wallet prepared. Waiting for ACC proof…';
    case 'acc-proof':
      return 'Proving the ACC deposit…';
    case 'wallet-balancing':
      return 'Balancing the proved ACC deposit with the funding wallet…';
    case 'acc-submitted':
    case 'credit-confirmation':
      return 'Funding deposit was sent. Waiting for confirmed ACC credit…';
    default:
      return progress?.depositTxId
        ? 'Funding deposit was sent. Waiting for confirmed ACC credit…'
        : progress?.preparationTxId
          ? 'Funding wallet is prepared. Proving the ACC deposit…'
          : 'Funding is processing. The original request is saved and can be checked after reload…';
  }
}

export interface FundingConfirmation extends FundingOriginalIdentity {
  readonly amount: string;
  readonly txId: string;
  readonly preparationTxId?: string;
  readonly creditedBalance: string;
}

export function checkedFundingConfirmation(
  result: Record<string, unknown>,
  identity: FundingOriginalIdentity & { readonly amount: string },
): FundingConfirmation {
  const txId = result.txId;
  const preparationTxId = result.preparationTxId;
  const creditedBalance = result.creditedBalance;
  if (
    result.requestId !== identity.requestId ||
    result.accountAddress !== identity.accountAddress ||
    result.color !== identity.color ||
    result.amount !== identity.amount ||
    typeof txId !== 'string' ||
    !/^(?:[0-9a-f]{64}|[0-9a-f]{66})$/.test(txId) ||
    (preparationTxId !== undefined &&
      (typeof preparationTxId !== 'string' ||
        !/^(?:[0-9a-f]{64}|[0-9a-f]{66})$/.test(preparationTxId))) ||
    typeof creditedBalance !== 'string' ||
    !/^\d+$/.test(creditedBalance)
  )
    throw fundingUnsettled('Funding service returned an invalid confirmation');
  return {
    ...identity,
    txId,
    ...(preparationTxId && { preparationTxId }),
    creditedBalance,
  };
}

/** A status read never starts a wallet operation or changes the original request. */
export function parseFundingOriginalStatus(
  value: unknown,
  identity: FundingOriginalIdentity,
): FundingOriginalStatus {
  if (
    !object(value) ||
    value.requestId !== identity.requestId ||
    value.accountAddress !== identity.accountAddress ||
    value.color !== identity.color ||
    typeof value.amount !== 'string' ||
    !/^[1-9][0-9]*$/.test(value.amount) ||
    (identity.amount !== undefined && value.amount !== identity.amount) ||
    !['pending', 'complete', 'released'].includes(String(value.state)) ||
    (value.state === 'complete' &&
      (!object(value.result) || value.result.requestId !== identity.requestId))
  )
    throw fundingUnsettled('Funding service returned an invalid original status.');
  return {
    state: value.state as FundingOriginalStatus['state'],
    amount: value.amount,
    ...(object(value.result) && { result: value.result }),
    ...(object(value.progress) && { progress: value.progress }),
  };
}

export async function waitForFundingOriginal(
  read: () => Promise<unknown>,
  identity: FundingOriginalIdentity,
  onPending: (progress: FundingOriginalStatus['progress']) => void,
  options: {
    readonly now?: () => number;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly timeoutMs?: number;
    readonly pollMs?: number;
  } = {},
): Promise<FundingOriginalStatus> {
  const now = options.now ?? Date.now;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 30 * 60_000;
  const pollMs = options.pollMs ?? 5000;
  const deadline = now() + timeoutMs;
  for (;;) {
    const status = parseFundingOriginalStatus(await read(), identity);
    if (status.state !== 'pending') return status;
    onPending(status.progress);
    if (now() >= deadline)
      throw fundingUnsettled(
        'Funding is still pending. Continue funding later to check this same original request.',
      );
    await sleep(pollMs);
  }
}

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
export function parseFundingDiscovery(
  value: unknown,
  options: { readonly requireAvailability?: boolean } = {},
) {
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
    if (
      options.requireAvailability &&
      raw.availability !== 'available' &&
      raw.availability !== 'insufficient' &&
      raw.availability !== 'unavailable'
    )
      throw new Error('Invalid funding availability');
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
  const released =
    status === 409 &&
    body.requestId === requestId &&
    body.submission === 'reconciled-no-credit' &&
    body.code === 'FundingRequestReleased' &&
    !('txId' in body) &&
    !('preparationTxId' in body);
  const error = new Error(
    released
      ? 'The previous funding request was reconciled without ACC credit. Click Fund Passport account again to start a new deposit.'
      : notStarted
        ? body.code === 'FundingAssetUnavailable'
          ? 'The funding wallet does not hold enough of this asset. No transfer was started.'
          : 'The funding wallet is not ready. No transfer was started.'
        : typeof body.error === 'string'
          ? body.error
          : 'Funding was refused',
  );
  error.name = notStarted || released ? String(body.code) : 'FundingRejected';
  return { error, notStarted, released };
}
