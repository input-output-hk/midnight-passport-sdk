import { PassportConnectorError } from './errors.js';
import type { DeviceReader, LiveDeviceReader } from './ports/index.js';
import type { ReaderResolution } from './jubjub-readers.js';

/** Only the current ledger-matching roster may authenticate the excluded target.
 * Earlier envelopes can carry sender-chosen secrets, with no evidence their keys were
 * ever on chain. Durable resumption replays the original verified snapshot instead.
 */
export async function resolveRemovalReader(
  current: ReaderResolution,
  _history: {
    read?: () => Promise<readonly DeviceReader[]>;
    resolve: (registered: readonly DeviceReader[]) => ReaderResolution;
  },
): Promise<LiveDeviceReader> {
  const excluded = current.outside;
  const removed = excluded[0];
  if (excluded.length !== 1 || !removed)
    throw new PassportConnectorError(
      'DeviceRosterInvalid',
      'The removed entry needs one distinct authenticated reader registration.',
    );
  if (
    current.readers.some(
      (survivor) =>
        survivor.readerPublicKey === removed.readerPublicKey ||
        survivor.devicePublicKey === removed.devicePublicKey,
    )
  )
    throw new PassportConnectorError(
      'DeviceRosterInvalid',
      'The removed device shares a reader or signing key with a survivor.',
    );
  return removed;
}
