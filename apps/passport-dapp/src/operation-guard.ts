import { PassportConnectorError } from '@input-output-hk/mn-passport-account';
import type { ActionId } from './flows.js';

const publicActions = new Set<ActionId>([
  'refresh',
  'roster',
  'grantRoster',
  'walletRefresh',
  'endSession',
]);

/** Same-origin tabs serialize credential/mutation flows; no expiring storage lease or silent fallback. */
export function demoOperationGuard(
  networkId: string,
  bindingId: string,
  locks: Pick<LockManager, 'request'> | undefined,
) {
  const name = `passport-demo:operation:v1:${networkId}:${bindingId}`;
  return async (action: ActionId, operation: () => Promise<void>): Promise<void> => {
    if (publicActions.has(action)) return operation();
    if (!locks)
      throw new PassportConnectorError(
        'BindingUnsupported',
        'This demo requires browser Web Locks for coordinated authenticated/value operations. Public reads remain available.',
      );
    return locks.request(name, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock)
        throw new PassportConnectorError(
          'UserCancelled',
          'Another Passport tab is handling an operation. Wait for its result; do not start a replacement transfer.',
        );
      await operation();
    });
  };
}
