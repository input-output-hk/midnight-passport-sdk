import { PassportConnectorError } from './errors.js';
import type { DeviceReader, LiveDeviceReader } from './ports/index.js';
import type { ReaderResolution } from './jubjub-readers.js';

/** Historical metadata may identify the exact excluded target, never fresh-key recipients. */
export async function resolveRemovalReader(
  current: ReaderResolution,
  history: {
    read?: () => Promise<readonly DeviceReader[]>;
    resolve: (registered: readonly DeviceReader[]) => ReaderResolution;
  },
): Promise<LiveDeviceReader> {
  let excluded = current.outside;
  if (!excluded.length && history.read) excluded = history.resolve(await history.read()).outside;
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
