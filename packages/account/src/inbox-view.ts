import type { AccLedgerView, Chain } from './ports/index.js';
import { PassportConnectorError } from './errors.js';

/** Data availability only. Neither type establishes binding support, ownership or finality. */
export type InboxLedgerView = AccLedgerView & {
  readonly encKey: Uint8Array;
  readonly inboxEntries: readonly Uint8Array[];
};
export type DeviceInboxLedgerView = InboxLedgerView & {
  readonly deviceEntries: readonly Uint8Array[];
};
export function hasInbox(view: AccLedgerView): view is InboxLedgerView {
  return Boolean(view.encKey && view.inboxEntries);
}
export function requireDeviceInbox(view: InboxLedgerView): asserts view is DeviceInboxLedgerView {
  if (!view.deviceEntries)
    throw new PassportConnectorError('BindingUnsupported', 'The chain port omits live devices.');
}

/** Retain the shape checked at the chain boundary instead of losing it before key operations. */
export function accountInboxReader(load: () => Promise<Pick<Chain, 'readAccount'>>) {
  function read(
    record: { readonly address: string },
    devices: true,
  ): Promise<DeviceInboxLedgerView>;
  function read(record: { readonly address: string }, devices?: false): Promise<InboxLedgerView>;
  async function read(
    record: { readonly address: string },
    devices = false,
  ): Promise<InboxLedgerView> {
    const view = await (
      await load()
    ).readAccount(record.address, { includeInbox: true, ...(devices && { includeDevices: true }) });
    if (!view) throw new PassportConnectorError('AccountNotFound', `No ACC at ${record.address}.`);
    if (!hasInbox(view))
      throw new PassportConnectorError('BindingUnsupported', 'The chain port omits the ACC inbox.');
    if (devices) requireDeviceInbox(view);
    return view;
  }
  return read;
}
