import { parseFundingDiscovery, type DemoFundingAsset } from './funding.js';
import { fundingReadGuard } from './funding-read-guard.js';
import { fundingObservation, fundingPause } from './funding-observation.js';

export type FundingReadState = 'checking' | 'waiting' | 'ready' | 'unavailable';

export function fundingReadMessage(state: FundingReadState): string {
  return state === 'checking'
    ? 'Checking deposit availability…'
    : state === 'waiting'
      ? 'Checking the funding wallet again…'
      : state === 'unavailable'
        ? 'Availability could not be confirmed. Refresh to check again.'
        : '';
}

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
  readonly fetch: (
    url: string,
    init?: { signal?: AbortSignal },
  ) => Promise<{ readonly ok: boolean; json(): Promise<unknown> }>;
  readonly show: (view: FundingBalanceView) => void;
  readonly unavailable: (address: string) => void;
  readonly state?: (state: FundingReadState) => void;
  readonly pause?: (ms: number, signal: AbortSignal) => Promise<void>;
  readonly timeoutMs?: number;
}) {
  const begin = fundingReadGuard(options.current);
  const endpoint = options.url.toString();
  let active: AbortController | undefined;
  const read = async (
    address: string,
  ): Promise<{ night: string; fundedAsset: string } | undefined> => {
    active?.abort();
    const color = options.color();
    if (!color) return;
    const controller = new AbortController();
    active = controller;
    const current = begin(address);
    const isCurrent = () => !controller.signal.aborted && current();
    try {
      if (!isCurrent()) return;
      const url = new URL(endpoint);
      url.searchParams.set('accountAddress', address);
      // Inventory can temporarily be unknown immediately after a confirmed deposit.
      // Only repeat this GET observation, never the transfer or its request ID.
      for (let attempt = 0; attempt < 3; attempt++) {
        options.state?.('checking');
        const body = (await fundingObservation(
          options.fetch,
          url.toString(),
          controller.signal,
          // Proxy budget: inventory (7s), health and ACC balance (30s), plus transport.
          options.timeoutMs ?? 45_000,
        )) as Record<string, unknown>;
        const balances = body?.balances as Record<string, unknown> | undefined;
        if (
          body?.accountAddress !== address ||
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
        const waiting = discovery.assets.some((asset) => asset.availability === 'unavailable');
        if (!waiting || attempt === 2) {
          options.state?.(waiting ? 'unavailable' : 'ready');
          return { night: balances.night, fundedAsset: balances.fundedAsset };
        }
        options.state?.('waiting');
        await (options.pause ?? fundingPause)((attempt + 1) * 1000, controller.signal);
        if (!isCurrent()) return;
      }
    } catch (error) {
      if (isCurrent()) {
        options.unavailable(address);
        options.state?.('unavailable');
        throw error;
      }
      return;
    } finally {
      if (active === controller) active = undefined;
    }
  };
  return Object.assign(read, { stop: () => active?.abort() });
}
