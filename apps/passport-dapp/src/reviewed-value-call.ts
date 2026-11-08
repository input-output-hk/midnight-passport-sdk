import type { CallRequest, TxResult } from '@input-output-hk/mn-passport-account/ports';
import { assertExactWithdrawal } from './consent.js';
import { withdrawalFromCall } from './exact-review.js';
import { demoValueCall } from './value-call.js';

/** Owner transfer transport: require the same exact intent immediately before POST. */
export function reviewedOwnerValueCall(
  serviceUrl: string,
  request: CallRequest,
): Promise<TxResult> {
  assertExactWithdrawal(withdrawalFromCall(request));
  return demoValueCall(serviceUrl, request);
}
