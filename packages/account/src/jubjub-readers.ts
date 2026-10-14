import { fromHex, toHex } from './codec.js';
import type {
  CurvePoint,
  DeviceReader,
  JubjubPureCircuits,
  LiveDeviceReader,
} from './ports/index.js';

/** Lace PR #2845 scans these counters for each registered JubJub device. */
export const JUBJUB_READER_SCAN_LIMIT = 4096n;
const MAX_LIVE_DEVICES = 64;
const MAX_REGISTRATIONS = 256;
const key = (entry: Uint8Array): string => toHex(entry);

export interface ReaderResolution {
  /** Unique registered readers with an entry in the allowed live device set. */
  readonly readers: readonly LiveDeviceReader[];
  /** Allowed live commitments without an unambiguous registered reader. */
  readonly dropped: readonly Uint8Array[];
  /** Registered readers whose entry is live but deliberately excluded. */
  readonly outside: readonly LiveDeviceReader[];
}

export interface ResolveJubjubReaders {
  readonly account: string;
  readonly epoch: bigint;
  /** Device registrations opened under the current account roster key. */
  readonly registered: readonly DeviceReader[];
  /** The ledger's live device commitments, not directory or inbox claims. */
  readonly liveEntries: readonly Uint8Array[];
  /** The subset the operation may keep; defaults to all live entries. */
  readonly allowedEntries?: readonly Uint8Array[];
  readonly pure: Pick<JubjubPureCircuits, 'derive_device_entry_with_jubjub'>;
  readonly decodeDevicePublicKey: (compressedHex: string) => CurvePoint | undefined;
}

/** Resolve sealed roster claims against actual ACC device entries before delivering a new key. */
export function resolveJubjubReaders({
  account,
  epoch,
  registered,
  liveEntries,
  allowedEntries = liveEntries,
  pure,
  decodeDevicePublicKey,
}: ResolveJubjubReaders): ReaderResolution {
  if (registered.length > MAX_REGISTRATIONS) throw new Error('too many device registrations');
  if (liveEntries.length > MAX_LIVE_DEVICES) throw new Error('too many live device entries');
  const live = new Set<string>();
  for (const entry of liveEntries) {
    if (entry.length !== 32) throw new Error('malformed live device entry');
    const value = key(entry);
    if (live.has(value)) throw new Error('duplicate live device entry');
    live.add(value);
  }
  const allowed = new Set<string>();
  for (const entry of allowedEntries) {
    const value = key(entry);
    if (!live.has(value)) throw new Error('allowed device entry is not live');
    allowed.add(value);
  }
  const self = { bytes: fromHex(account) };
  if (self.bytes.length !== 32) throw new Error('ACC address must be 32 bytes');
  const resolved = new Map<string, { reader: LiveDeviceReader; entry: string }>();
  const entriesByReader = new Map<string, Set<string>>();
  const readersByEntry = new Map<string, Set<string>>();
  const outside: LiveDeviceReader[] = [];
  for (const registration of registered) {
    if (!/^[0-9a-f]{64}$/.test(registration.readerPublicKey)) continue;
    const point = decodeDevicePublicKey(registration.devicePublicKey);
    if (!point) continue;
    let found: { entry: string; counter: bigint } | undefined;
    for (let counter = 0n; counter < JUBJUB_READER_SCAN_LIMIT; counter++) {
      const candidate = key(pure.derive_device_entry_with_jubjub(self, point, epoch, counter));
      if (live.has(candidate)) {
        found = { entry: candidate, counter };
        break;
      }
    }
    if (!found) continue;
    const reader: LiveDeviceReader = { ...registration, epoch, counter: found.counter };
    if (!allowed.has(found.entry)) {
      outside.push(reader);
      continue;
    }
    resolved.set(`${reader.readerPublicKey}:${found.entry}`, { reader, entry: found.entry });
    const entries = entriesByReader.get(reader.readerPublicKey) ?? new Set<string>();
    entries.add(found.entry);
    entriesByReader.set(reader.readerPublicKey, entries);
    const readers = readersByEntry.get(found.entry) ?? new Set<string>();
    readers.add(reader.readerPublicKey);
    readersByEntry.set(found.entry, readers);
  }
  const keptPairs = [...resolved.values()].filter(
    ({ reader, entry }) =>
      entriesByReader.get(reader.readerPublicKey)?.size === 1 &&
      readersByEntry.get(entry)?.size === 1,
  );
  const kept = new Set(keptPairs.map(({ entry }) => entry));
  return {
    readers: keptPairs.map(({ reader }) => reader),
    dropped: liveEntries.filter((entry) => allowed.has(key(entry)) && !kept.has(key(entry))),
    outside,
  };
}
