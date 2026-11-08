const typedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const typedArrayName = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  Symbol.toStringTag,
)?.get;
const typedArrayByteLength = Object.getOwnPropertyDescriptor(
  typedArrayPrototype,
  'byteLength',
)?.get;
/** Read the actual storage length, including for Buffer and typed-array subclasses. */
export function inputByteLength(value: Uint8Array): number {
  if (!typedArrayByteLength || !typedArrayName) return -1;
  try {
    const name: unknown = Reflect.apply(typedArrayName, value, []);
    if (name !== 'Uint8Array') return -1;
    const length: unknown = Reflect.apply(typedArrayByteLength, value, []);
    return typeof length === 'number' ? length : -1;
  } catch {
    return -1;
  }
}
export function ownedKey(value: Uint8Array, message: string): Uint8Array {
  if (inputByteLength(value) !== 32) throw new Error(message);
  return new Uint8Array(value);
}

/** Malformed wire entries stay noise, without copying unbounded attacker-controlled bytes. */
export function ownedEntries(entries: readonly Uint8Array[], message: string): Uint8Array[] {
  const count = entries.length;
  if (!Number.isSafeInteger(count) || count < 0 || count > 4096) throw new Error(message);
  const owned: Uint8Array[] = [];
  for (let index = 0; index < count; index++) {
    const entry = entries[index];
    owned.push(entry && inputByteLength(entry) === 192 ? new Uint8Array(entry) : new Uint8Array(0));
  }
  return owned;
}
