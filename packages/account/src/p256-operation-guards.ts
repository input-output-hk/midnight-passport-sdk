/** Live optional capabilities are checked at use, without caching credential methods. */
import { PassportConnectorError } from './errors.js';
import { hasInbox, type InboxLedgerView } from './inbox-view.js';
import type { AccLedgerView, AccPureCircuits, Authoriser, PassportPorts } from './ports/index.js';

export const equalBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export function deviceBinding(authoriser: Authoriser) {
  const method = authoriser.deviceBinding;
  if (!method)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'The P-256 device binding is unavailable.',
    );
  return method.call(authoriser);
}
export function inboxView(view: AccLedgerView): InboxLedgerView {
  if (!hasInbox(view))
    throw new PassportConnectorError('BindingUnsupported', 'The chain port omits the ACC inbox.');
  return view;
}
export function holdingsSource(ports: Pick<PassportPorts, 'holdings'>) {
  const holdings = ports.holdings;
  if (!holdings)
    throw new PassportConnectorError('BindingUnsupported', 'The holding source is unavailable.');
  return holdings;
}
export function withdrawChallenge(
  pure: AccPureCircuits,
  ...args: Parameters<NonNullable<AccPureCircuits['challenge_withdraw_unshielded_with_p256']>>
) {
  const method = pure.challenge_withdraw_unshielded_with_p256;
  if (!method)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'The withdrawal challenge is unavailable.',
    );
  return method.apply(pure, args);
}
export function shieldedChallenge(
  pure: AccPureCircuits,
  ...args: Parameters<NonNullable<AccPureCircuits['challenge_withdraw_shielded_with_p256']>>
) {
  const method = pure.challenge_withdraw_shielded_with_p256;
  if (!method)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'The shielded withdrawal challenge is unavailable.',
    );
  return method.apply(pure, args);
}
