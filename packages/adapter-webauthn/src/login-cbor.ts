/** A bounded, definite-length CBOR extension map; never interprets extension values as secrets. */
export function validLoginExtensions(bytes: Uint8Array): boolean {
  if (bytes.length === 0 || bytes.length > 4096 || (bytes[0] ?? 0) >> 5 !== 5) return false;
  let offset = 0;
  let items = 0;
  const take = (length: number): Uint8Array => {
    if (offset + length > bytes.length) throw new Error('Truncated CBOR');
    const result = bytes.subarray(offset, offset + length);
    offset += length;
    return result;
  };
  const argument = (additional: number): bigint => {
    if (additional < 24) return BigInt(additional);
    const length = new Map([
      [24, 1],
      [25, 2],
      [26, 4],
      [27, 8],
    ]).get(additional);
    if (length === undefined) throw new Error('Unsupported CBOR length');
    return take(length).reduce((value, byte) => (value << 8n) | BigInt(byte), 0n);
  };
  const item = (depth: number): void => {
    if (depth > 8 || ++items > 128) throw new Error('CBOR complexity limit');
    const first = take(1)[0] ?? 0;
    const major = first >> 5;
    const additional = first & 31;
    if (major === 7) {
      if (additional < 24) return;
      const value = argument(additional);
      if (additional === 24 && value < 32n) throw new Error('Reserved CBOR simple value');
      return;
    }
    const value = argument(additional);
    if (major < 2) return;
    if (major === 6) return item(depth + 1);
    if (value > 4096n) throw new Error('CBOR size limit');
    const length = Number(value);
    if (major === 2 || major === 3) {
      const content = take(length);
      if (major === 3) new TextDecoder('utf-8', { fatal: true }).decode(content);
      return;
    }
    const children = major === 5 ? length * 2 : length;
    for (let index = 0; index < children; index++) item(depth + 1);
  };
  try {
    item(0);
    return offset === bytes.length;
  } catch {
    return false;
  }
}
