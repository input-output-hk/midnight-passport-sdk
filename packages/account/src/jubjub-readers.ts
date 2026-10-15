import { fromHex, toHex } from './codec.js';
import type {
  CurvePoint,
  DeviceReader,
  JubjubPureCircuits,
  LiveDeviceReader,
  P256PublicKey,
  AccPureCircuits,
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

export interface ResolveRegisteredReaders extends ResolveJubjubReaders {
  readonly p256Pure: Pick<AccPureCircuits, 'derive_device_entry_with_p256'>;
  readonly decodeP256DevicePublicKey: (compressedHex: string) => P256PublicKey | undefined;
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
  return resolveReaders({
    account,
    epoch,
    registered,
    liveEntries,
    allowedEntries,
    pure,
    decodeDevicePublicKey,
  });
}

/** Match both registration schemes against the ACC's live entries; key-only P-256 records are unverifiable. */
export function resolveRegisteredReaders(input: ResolveRegisteredReaders): ReaderResolution {
  return resolveReaders(input);
}

function resolveReaders({
  account,
  epoch,
  registered,
  liveEntries,
  allowedEntries = liveEntries,
  pure,
  decodeDevicePublicKey,
  ...p256Support
}: ResolveJubjubReaders &
  Partial<
    Pick<ResolveRegisteredReaders, 'p256Pure' | 'decodeP256DevicePublicKey'>
  >): ReaderResolution {
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
    if (
      registration.scheme &&
      registration.scheme !== 'p256-webauthn' &&
      registration.scheme !== 'jubjub-schnorr'
    )
      continue;
    const isP256 = registration.scheme === 'p256-webauthn';
    if (
      isP256 &&
      (!registration.policy ||
        !(registration.policy.rp_id_hash instanceof Uint8Array) ||
        registration.policy.rp_id_hash.length !== 32 ||
        !(registration.policy.origin instanceof Uint8Array) ||
        registration.policy.origin.length !== 21 ||
        !p256Support.p256Pure ||
        !p256Support.decodeP256DevicePublicKey)
    )
      continue;
    const point = isP256
      ? p256Support.decodeP256DevicePublicKey!(registration.devicePublicKey)
      : decodeDevicePublicKey(registration.devicePublicKey);
    if (!point || (!isP256 && registration.policy)) continue;
    let found: { entry: string; counter: bigint } | undefined;
    for (let counter = 0n; counter < JUBJUB_READER_SCAN_LIMIT; counter++) {
      const candidate = key(
        isP256
          ? p256Support.p256Pure!.derive_device_entry_with_p256(
              self,
              point as P256PublicKey,
              registration.policy!,
              epoch,
              counter,
            )
          : pure.derive_device_entry_with_jubjub(self, point, epoch, counter),
      );
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
