import type { FetchLike } from '@input-output-hk/mn-passport-account/ports';

/** Bound the native Fetch stream before JSON parsing; custom transports must bound their json(). */
export async function boundedJson(
  response: Awaited<ReturnType<FetchLike>>,
  maximum: number,
): Promise<unknown> {
  const length = response.headers?.get('content-length');
  if (
    length !== undefined &&
    length !== null &&
    (!/^\d+$/.test(length) || Number(length) > maximum)
  ) {
    const reader = response.body?.getReader();
    if (reader) {
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
    throw new Error('Response exceeds its byte limit.');
  }
  if (!response.body) {
    const value = await response.json();
    // Compatibility for the existing structural fetch port. This check is after parsing;
    // injected transports own their allocation limit. Native fetch always uses the stream.
    const text = JSON.stringify(value);
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > maximum)
      throw new Error('Response exceeds its byte limit.');
    return value;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let done = false;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) {
        done = true;
        break;
      }
      if (!(next.value instanceof Uint8Array) || size + next.value.byteLength > maximum)
        throw new Error('Response exceeds its byte limit.');
      chunks.push(next.value);
      size += next.value.byteLength;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally {
    if (!done) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
