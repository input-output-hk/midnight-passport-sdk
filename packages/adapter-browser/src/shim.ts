import type { PassportConnectorDescriptor } from '@midnight-ntwrk/mn-passport-protocol';

/** Installs the connector the way a wallet injects into `window.midnight` (spec §4.1). */
export function injectPassportConnector(
  target: { midnight?: Record<string, unknown> },
  descriptor: PassportConnectorDescriptor,
): void {
  target.midnight ??= {};
  target.midnight.passport = Object.freeze(descriptor);
}
