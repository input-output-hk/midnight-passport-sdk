import { parseFundingDiscovery, type DemoFundingAsset } from './funding.js';
import { fundingReadGuard } from './funding-read-guard.js';

interface FundingBalanceView {
  readonly address: string;
  readonly color: string;
  readonly night: string;
  readonly fundedAsset: string;
  readonly assets: readonly DemoFundingAsset[];
}

/** Reference-app read orchestration. All UI projections, including errors, share one fence. */
export function createFundingBalanceReader(options: {
  readonly current: () => { readonly address: string } | undefined;
  readonly color: () => string | undefined;
  readonly url: URL;
  readonly fetch: (url: string) => Promise<{ readonly ok: boolean; json(): Promise<unknown> }>;
  readonly show: (view: FundingBalanceView) => void;
  readonly unavailable: (address: string) => void;
}) {
  const begin = fundingReadGuard(options.current);
  const endpoint = options.url.toString();
  return async (address: string): Promise<{ night: string; fundedAsset: string } | undefined> => {
    const color = options.color();
    if (!color) return;
    const isCurrent = begin(address);
    if (!isCurrent()) return;
    try {
      const url = new URL(endpoint);
      url.searchParams.set('accountAddress', address);
      const response = await options.fetch(url.toString());
      if (!response.ok) throw new Error('ACC balance read unavailable');
      const body = (await response.json()) as Record<string, unknown>;
      const balances = body.balances as Record<string, unknown> | undefined;
      if (
        body.accountAddress !== address ||
        typeof balances?.night !== 'string' ||
        !/^\d+$/.test(balances.night) ||
        typeof balances.fundedAsset !== 'string' ||
        !/^\d+$/.test(balances.fundedAsset)
      )
        throw new Error('ACC balance response is invalid');
      const discovery = parseFundingDiscovery(body);
      if (!isCurrent()) return;
      options.show({
        address,
        color,
        assets: discovery.assets,
        night: balances.night,
        fundedAsset: balances.fundedAsset,
      });
      return { night: balances.night, fundedAsset: balances.fundedAsset };
    } catch (error) {
      if (isCurrent()) {
        options.unavailable(address);
        throw error;
      }
      return;
    }
  };
}
