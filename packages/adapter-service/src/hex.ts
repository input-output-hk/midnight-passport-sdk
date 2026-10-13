export const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

export function fromHex(text: string): Uint8Array {
  const clean = text.startsWith('0x') ? text.slice(2) : text;
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(clean))
    throw new Error(`invalid hex: ${text.slice(0, 16)}…`);
  return Uint8Array.from({ length: clean.length / 2 }, (_, i) =>
    Number.parseInt(clean.slice(2 * i, 2 * i + 2), 16),
  );
}
