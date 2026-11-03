// Bounded qualification guard for declared encodings; not a universal non-disclosure proof.
import { Buffer } from 'node:buffer';

/** @param {unknown} value @param {readonly string[]} forbiddenHex */
export function assertNoSecretMaterial(value, forbiddenHex) {
  const secrets = forbiddenHex.map((hex) => {
    if (!/^(?:[a-fA-F0-9]{2}){16,128}$/.test(hex)) throw Error('Invalid secret-scan input');
    const bytes = Buffer.from(hex, 'hex'),
      base64 = bytes.toString('base64');
    return {
      bytes,
      hex: hex.toLowerCase(),
      integers: [BigInt('0x' + hex), BigInt('0x' + Buffer.from(bytes).reverse().toString('hex'))],
      encodings: [
        base64,
        base64.replace(/=+$/, ''),
        base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
      ],
    };
  });
  const seen = new WeakSet();
  let budget = 2 * 1024 * 1024,
    nodes = 0;
  const failure = () => {
    throw Error('Secret material detected or scan bounds exceeded');
  };
  /** @param {number} bytes */
  const charge = (bytes) => {
    budget -= bytes;
    if (budget < 0) failure();
  };
  /** @param {string} text */
  const text = (text) => {
    charge(Buffer.byteLength(text));
    for (const secret of secrets) {
      if (
        text.toLowerCase().includes(secret.hex) ||
        secret.encodings.some((e) => text.includes(e)) ||
        secret.integers.some((v) => text.includes(v.toString()))
      )
        failure();
    }
    // A text label can join a base64 envelope without a separator. Inspect all four
    // character alignments; tolerate trailing encoding bits rather than skipping the run.
    for (const match of text.matchAll(/[A-Za-z0-9+/_-]{22,}={0,2}/g)) {
      const token = match[0].replace(/-/g, '+').replace(/_/g, '/');
      for (let offset = 0; offset < 4; offset++) {
        const decoded = Buffer.from(token.slice(offset), 'base64');
        charge(decoded.length);
        if (secrets.some((secret) => decoded.includes(secret.bytes))) failure();
      }
    }
  };
  /** @param {Uint8Array} input */
  const binary = (input) => {
    const bytes = Buffer.from(input);
    charge(bytes.length);
    if (secrets.some((secret) => bytes.includes(secret.bytes))) failure();
    text(bytes.toString('utf8'));
  };
  /** @param {unknown} input @param {number} depth */
  const walk = (input, depth) => {
    if (++nodes > 100000 || depth > 32) failure();
    if (typeof input === 'string') {
      text(input);
      return;
    }
    if (typeof input === 'bigint') {
      charge(input.toString().length);
      if (secrets.some((secret) => secret.integers.includes(input))) failure();
      return;
    }
    if (input === null || input === undefined || ['boolean', 'number'].includes(typeof input))
      return;
    if (typeof input !== 'object') return failure();
    if (seen.has(input)) return failure();
    seen.add(input);
    try {
      if (
        input instanceof ArrayBuffer ||
        (typeof SharedArrayBuffer !== 'undefined' && input instanceof SharedArrayBuffer)
      ) {
        binary(new Uint8Array(input));
        return;
      }
      if (ArrayBuffer.isView(input)) {
        binary(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
        return;
      }
      if (Array.isArray(input)) {
        if (input.every((v) => Number.isInteger(v) && v >= 0 && v <= 255))
          binary(Uint8Array.from(input));
        else for (const item of input) walk(item, depth + 1);
        return;
      }
      if (
        Object.getPrototypeOf(input) !== Object.prototype &&
        Object.getPrototypeOf(input) !== null
      )
        return failure();
      for (const [key, item] of Object.entries(input)) {
        text(key);
        walk(item, depth + 1);
      }
    } finally {
      // Reject active recursion cycles; harmless shared objects may be scanned again.
      seen.delete(input);
    }
  };
  walk(value, 0);
}
