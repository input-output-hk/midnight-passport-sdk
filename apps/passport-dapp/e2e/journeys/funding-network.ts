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

async function fundingStatusRoute(h: JourneyHarness, route: Route, url: URL) {
  const { flags, fundedIds } = h;
  const requestId = url.pathname.slice('/v1/demo/funding/'.length);
  h.calls.push('funding-status');
  if (flags.unknownFunding || flags.serviceUnavailable) {
    await route.fulfill({ status: 503, json: { error: 'Synthetic funding status unavailable' } });
    return;
  }
  const creditedBalance = fundedIds.get(requestId);
  const pending = (flags.pendingFundingStatusReads ?? 0) > 0;
  if (pending) flags.pendingFundingStatusReads = (flags.pendingFundingStatusReads ?? 0) - 1;
  await route.fulfill({
    json: {
      requestId,
      accountAddress: address,
      color: night,
      amount: '10',
      state: pending || creditedBalance === undefined ? 'pending' : 'complete',
      ...(!pending &&
        creditedBalance !== undefined && {
          result: { requestId, txId: '70'.repeat(32), creditedBalance: String(creditedBalance) },
        }),
    },
  });
  return;
}

async function fundingPostRoute(h: JourneyHarness, route: Route) {
  const { flags, state, fundedIds, fundingIds } = h;
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
    fundedIds.set(data.requestId, data.color === night ? state.night : (balances[data.color] ?? 0));
    flags.unavailableFundingReads = flags.unavailableAfterDeposit ?? 0;
  }
  if (flags.asyncFunding) {
    await route.fulfill({ status: 202, json: { requestId: data.requestId, state: 'pending' } });
    return;
  }
  await route.fulfill({
    json: {
      ...data,
      amount: '10',
      txId: '70'.repeat(32),
      creditedBalance: String(fundedIds.get(data.requestId)),
    },
  });
}

export async function fundingRoute(h: JourneyHarness, route: Route, url: URL) {
  const { flags, state } = h;
  if (url.pathname.startsWith('/v1/demo/funding/')) return fundingStatusRoute(h, route, url);
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
  if (route.request().method() === 'POST') return fundingPostRoute(h, route);
  if (url.searchParams.has('accountAddress'))
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
