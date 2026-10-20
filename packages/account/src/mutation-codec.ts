import { utf8ToBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import type { MutationDocument, MutationValue } from './mutation-types.js';

export const MUTATION_MAX_BYTES = 8 * 1024 * 1024;
export const MUTATION_MAX_STEPS = 512;
export const mutationFailure = (message: string): never => {
  throw new PassportConnectorError('MutationUnsettled', message);
};
/** Canonical tagged wire format; reject functions, unsafe numbers and reserved object keys. */
export function encodeMutationValue(value: unknown, depth = 0): MutationValue {
  if (depth > 32) return mutationFailure('Mutation value nesting exceeds the bound.');
  if (value === undefined) return { $undefined: true };
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value))
      return mutationFailure('Mutation numbers must be safe integers.');
    return value;
  }
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (value instanceof Uint8Array) return { $bytes: toHex(value) };
  if (Array.isArray(value)) return value.map((item) => encodeMutationValue(item, depth + 1));
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype)
    return mutationFailure('Mutation value is not serializable.');
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => {
        if (
          key.startsWith('$') ||
          key === '__proto__' ||
          key === 'constructor' ||
          key === 'prototype'
        )
          return mutationFailure('Mutation value contains a reserved key.');
        return [key, encodeMutationValue(item, depth + 1)];
      }),
  );
}
export function decodeMutationValue(value: MutationValue, depth = 0): unknown {
  if (depth > 32) return mutationFailure('Mutation value nesting exceeds the bound.');
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => decodeMutationValue(item, depth + 1));
  const keys = Object.keys(value);
  if (keys.length === 1 && value.$undefined === true) return undefined;
  if (keys.length === 1 && typeof value.$bigint === 'string' && /^-?\d{1,100}$/.test(value.$bigint))
    return BigInt(value.$bigint);
  if (
    keys.length === 1 &&
    typeof value.$bytes === 'string' &&
    /^(?:[0-9a-f]{2})*$/.test(value.$bytes)
  )
    return fromHex(value.$bytes);
  if (
    keys.some(
      (key) => key.startsWith('$') || ['__proto__', 'constructor', 'prototype'].includes(key),
    )
  )
    return mutationFailure('Mutation wire value contains a reserved key.');
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, decodeMutationValue(item, depth + 1)]),
  );
}
export const mutationDigest = (value: unknown): string =>
  toHex(sha256(utf8ToBytes(JSON.stringify(encodeMutationValue(value)))));
function validateLedger(value: unknown): void {
  const l = value as import('./mutation-types.js').MutationLedger;
  const bounded = (n: unknown) => typeof n === 'bigint' && n >= 0n && n < 1n << 64n;
  if (
    !l ||
    typeof l.booted !== 'boolean' ||
    !bounded(l.authNonce) ||
    !bounded(l.deviceEpoch) ||
    l.specVersion !== 3 ||
    !(l.encKey instanceof Uint8Array) ||
    l.encKey.length !== 32 ||
    !Array.isArray(l.inboxEntries) ||
    l.inboxEntries.length > 4096 ||
    !Array.isArray(l.deviceEntries) ||
    l.deviceEntries.length > 64 ||
    l.entryCount !== l.deviceEntries.length ||
    l.deviceEntries.some((e) => !(e instanceof Uint8Array) || e.length !== 32) ||
    l.inboxEntries.some((e) => !(e instanceof Uint8Array) || e.length !== 192) ||
    new Set(l.deviceEntries.map(toHex)).size !== l.entryCount
  )
    return mutationFailure('Invalid protected ledger snapshot.');
}
export function validateMutationDocument(value: unknown): asserts value is MutationDocument {
  const d = value as MutationDocument;
  if (
    !d ||
    d.version !== 1 ||
    !/^[0-9a-f]{32}$/.test(d.id) ||
    !Number.isSafeInteger(d.revision) ||
    d.revision < 0 ||
    !['pending', 'cancelled', 'complete'].includes(d.phase) ||
    !(d.randomSeed instanceof Uint8Array) ||
    d.randomSeed.length !== 32 ||
    !d.pins ||
    !/^[a-z0-9-]{1,64}$/.test(d.pins.networkId) ||
    d.pins.bindingId !== 'acc-s3r1.1' ||
    d.pins.manifestSha256 !== '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f' ||
    !['p256-webauthn', 'jubjub-schnorr'].includes(d.pins.scheme) ||
    !Array.isArray(d.entries) ||
    d.entries.length > MUTATION_MAX_STEPS
  )
    return mutationFailure(
      'Invalid or unsupported mutation document; do not migrate it implicitly.',
    );
  const intent = d.intent;
  if (!intent || !['create', 'rotate', 'add-device', 'remove-device'].includes(intent.kind))
    return mutationFailure('Unknown mutation intent.');
  if (intent.kind === 'create') {
    if (
      typeof intent.userName !== 'string' ||
      intent.userName.length < 1 ||
      intent.userName.length > 256 ||
      typeof intent.retireAuthority !== 'boolean'
    )
      return mutationFailure('Invalid original creation/lock intent.');
  } else {
    if (!/^[0-9a-f]{64}$/.test(intent.account)) return mutationFailure('Invalid mutation account.');
    if (intent.kind === 'remove-device' && !/^[0-9a-f]{64}$/.test(intent.commitmentHex))
      return mutationFailure('Invalid removal intent.');
    if (
      intent.kind === 'add-device' &&
      (!intent.reader ||
        !/^[0-9a-f]{64}$/.test(intent.reader.readerPublicKey) ||
        !/^(?:[0-9a-f]{64}|0[23][0-9a-f]{64})$/.test(intent.reader.devicePublicKey))
    )
      return mutationFailure('Invalid enrolment intent.');
  }
  let unfinished = false;
  for (const entry of d.entries) {
    if (
      !entry ||
      typeof entry.name !== 'string' ||
      !/^[0-9a-f]{64}$/.test(entry.digest) ||
      !['prepared', 'running', 'done'].includes(entry.phase)
    )
      return mutationFailure('Invalid mutation transcript entry.');
    if (unfinished) return mutationFailure('A continuation has entries after an unfinished step.');
    unfinished = entry.phase !== 'done';
    if (entry.effect) {
      const e = entry.effect;
      if (
        e.key !== `${d.id}:${d.entries.indexOf(entry)}` ||
        e.digest !== entry.digest ||
        mutationDigest(e.input) !== e.digest ||
        !['call', 'deploy'].includes(e.kind)
      )
        return mutationFailure('Invalid protected submission intent.');
      if (
        e.kind === 'call' &&
        (!e.before || !e.after || !e.address || !/^[0-9a-f]{64}$/.test(e.address))
      )
        return mutationFailure('Incomplete protected call intent.');
      if (e.before) validateLedger(e.before);
      if (e.after) validateLedger(e.after);
    }
  }
  if (d.frontier) {
    if (!/^[0-9a-f]{64}$/.test(d.frontier.address))
      return mutationFailure('Invalid frontier address.');
    validateLedger(d.frontier.ledger);
  }
  if (d.phase === 'complete' && (unfinished || !d.frontier || !d.result))
    return mutationFailure('Incomplete continuation marked complete.');
  if (utf8ToBytes(JSON.stringify(encodeMutationValue(d))).length > MUTATION_MAX_BYTES)
    return mutationFailure('Mutation document exceeds the storage bound.');
}
export function mutationDocumentBytes(document: MutationDocument): Uint8Array {
  validateMutationDocument(document);
  return utf8ToBytes(JSON.stringify(encodeMutationValue(document)));
}
export function readMutationDocument(bytes: Uint8Array): MutationDocument {
  if (bytes.length > MUTATION_MAX_BYTES)
    return mutationFailure('Mutation document exceeds the storage bound.');
  let value: unknown;
  try {
    value = decodeMutationValue(
      JSON.parse(
        new (
          globalThis as unknown as {
            TextDecoder: new (
              encoding: string,
              options: { fatal: boolean },
            ) => { decode(value: Uint8Array): string };
          }
        ).TextDecoder('utf-8', { fatal: true }).decode(bytes),
      ) as MutationValue,
    );
  } catch {
    return mutationFailure('Corrupt mutation document.');
  }
  validateMutationDocument(value);
  return value;
}
