import { readFileSync } from 'node:fs';
import type { ServiceConfig } from '../config.ts';

const ADDRESS = /^[0-9a-f]{64}$/;
const DECIMAL = /^[1-9][0-9]*$/;

export interface DemoAsset {
  readonly color: string;
  readonly amount: string;
}

export type AssetAvailability = 'available' | 'insufficient' | 'unavailable';

/** Inventory failure disables deposits, while preserving the asset list for ACC reads/withdrawals. */
export async function availableDemoAssets(
  config: Pick<ServiceConfig, 'networkId' | 'bindingId' | 'manifestSha256'>,
  base: URL,
  token: string,
  assets: readonly DemoAsset[],
): Promise<readonly (DemoAsset & { availability: AssetAvailability })[]> {
  try {
    const response = await fetch(new URL('/v1/faucet/assets', base), {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Inventory unavailable');
    const body = (await response.json()) as Record<string, unknown>;
    if (
      body.networkId !== config.networkId ||
      body.bindingId !== config.bindingId ||
      body.manifestSha256 !== config.manifestSha256 ||
      !Array.isArray(body.assets) ||
      body.assets.length !== assets.length
    )
      throw new Error('Invalid inventory');
    const rows = body.assets as Record<string, unknown>[];
    return assets.map((asset) => {
      const matching = rows.filter((row) => row?.color === asset.color);
      const item = matching[0];
      if (
        matching.length !== 1 ||
        !item ||
        item.amount !== asset.amount ||
        typeof item.availability !== 'string' ||
        !['available', 'insufficient', 'unavailable'].includes(item.availability)
      )
        throw new Error('Invalid inventory asset');
      return { ...asset, availability: item.availability as AssetAvailability };
    });
  } catch {
    return assets.map((asset) => ({ ...asset, availability: 'unavailable' }));
  }
}

/** Only an exact backend receipt may tell the browser it can replace this request ID. */
export function preflightRefusal(result: Record<string, unknown>, requestId: string) {
  if (
    result.requestId !== requestId ||
    result.submission !== 'not-started' ||
    'txId' in result ||
    'preparationTxId' in result ||
    typeof result.code !== 'string' ||
    !['FundingAssetUnavailable', 'FundingWalletUnavailable'].includes(result.code)
  )
    return undefined;
  return {
    requestId,
    code: result.code,
    submission: 'not-started',
    error:
      result.code === 'FundingAssetUnavailable'
        ? 'The funding wallet does not hold enough of this asset.'
        : 'The funding wallet inventory is unavailable or not synchronized.',
  };
}

export function demoAssets(file: string): { assets: DemoAsset[]; balanceAssetColor: string } {
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 64)
    throw new Error('demo funding needs a valid asset policy');
  const assets = parsed.map((raw: unknown): DemoAsset => {
    const item = raw as Record<string, unknown>;
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item) ||
      typeof item.color !== 'string' ||
      !ADDRESS.test(item.color) ||
      typeof item.maxPerRequest !== 'string' ||
      !DECIMAL.test(item.maxPerRequest)
    )
      throw new Error('demo funding needs a valid asset policy');
    const limit = BigInt(item.maxPerRequest);
    return { color: item.color, amount: (limit < 10n ? limit : 10n).toString() };
  });
  if (new Set(assets.map((asset) => asset.color)).size !== assets.length)
    throw new Error('demo funding needs distinct asset colors');
  assets.sort((a, b) => Number(b.color === '00'.repeat(32)) - Number(a.color === '00'.repeat(32)));
  return {
    assets,
    balanceAssetColor:
      assets.find((asset) => asset.color !== '00'.repeat(32))?.color ?? '00'.repeat(32),
  };
}
