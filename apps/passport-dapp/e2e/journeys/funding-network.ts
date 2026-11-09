import type { Route } from 'playwright-core';
import type { JourneyHarness } from './types.js';
import { address, night } from './constants.js';

function fundingAssets(h: JourneyHarness, catchingUp: boolean) {
  return [
    {
      color: night,
      amount: '10',
      availability: catchingUp
        ? 'unavailable'
        : h.flags.emptyFunding
          ? 'insufficient'
          : 'available',
    },
    ...(h.flags.multipleFundingAssets
      ? [
          {
            color: 'cd'.repeat(32),
            amount: '10',
            availability: catchingUp
              ? 'unavailable'
              : h.flags.customFundingUnavailable
                ? 'insufficient'
                : 'available',
          },
        ]
      : []),
  ];
}

export async function fundingRoute(h: JourneyHarness, route: Route, url: URL) {
  const { flags, state, fundedIds, fundingIds } = h;
  const isRead = route.request().method() === 'GET';
  if (isRead && flags.fundingReadFailure) {
    await route.fulfill({ status: 503, json: { error: 'Synthetic funding read unavailable' } });
    return;
  }
  const catchingUp = isRead && (flags.unavailableFundingReads ?? 0) > 0;
  if (catchingUp) flags.unavailableFundingReads = (flags.unavailableFundingReads ?? 0) - 1;
  const assets = fundingAssets(h, catchingUp);
  if (isRead && !catchingUp) await flags.holdFundingRead?.();
  if (flags.serviceUnavailable) {
    await route.fulfill({ status: 503, json: { error: 'Synthetic service unavailable' } });
    return;
  }
  if (route.request().method() === 'POST') {
    const data = route.request().postDataJSON() as { requestId: string; color: string };
    fundingIds.push(data.requestId);
    if (flags.rejectFundingPreflight) {
      await route.fulfill({
        status: 409,
        json: {
          requestId: data.requestId,
          code: 'FundingAssetUnavailable',
          submission: 'not-started',
        },
      });
      return;
    }
    if (flags.unknownFunding) {
      await route.fulfill({
        status: 503,
        json: { error: 'Synthetic funding outcome unknown; reconcile original ID' },
      });
      return;
    }
    if (!fundedIds.has(data.requestId)) {
      const balances = (state.tokens ??= {});
      if (data.color === night) state.night += 10;
      else balances[data.color] = (balances[data.color] ?? 0) + 10;
      fundedIds.set(
        data.requestId,
        data.color === night ? state.night : (balances[data.color] ?? 0),
      );
      flags.unavailableFundingReads = flags.unavailableAfterDeposit ?? 0;
    }
    await route.fulfill({
      json: {
        ...data,
        amount: '10',
        txId: '70'.repeat(32),
        creditedBalance: String(fundedIds.get(data.requestId)),
      },
    });
  } else if (url.searchParams.has('accountAddress'))
    await route.fulfill({
      json: {
        accountAddress: address,
        assets,
        balanceAssetColor: flags.multipleFundingAssets ? 'cd'.repeat(32) : night,
        balances: {
          night: String(state.night),
          fundedAsset: String(
            flags.multipleFundingAssets ? (state.tokens?.['cd'.repeat(32)] ?? 0) : state.night,
          ),
        },
      },
    });
  else
    await route.fulfill({
      json: {
        assets,
        balanceAssetColor: flags.multipleFundingAssets ? 'cd'.repeat(32) : night,
      },
    });
}
