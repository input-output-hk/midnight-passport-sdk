/** Node host transport boundary. Abort covers headers and body reads; byte limits precede parsing. */
function cancel(body: ReadableStream<Uint8Array> | null): void {
  try {
    void body?.cancel().catch(() => {});
  } catch {
    // Best-effort cleanup must not replace the original refusal.
  }
}

export function abortable<T>(
  work: Promise<T>,
  signal: AbortSignal,
  late?: (value: T) => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      reject(new Error('Remote JSON observation aborted.'));
    };
    signal.addEventListener('abort', abort, { once: true });
    work.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        if (signal.aborted) {
          try {
            late?.(value);
          } catch {
            /* Cleanup is best effort. */
          }
        } else resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
  });
}

async function responseJson(
  response: Response,
  signal: AbortSignal,
  maximumBytes: number,
): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^(0|[1-9][0-9]{0,8})$/.test(declared) || Number(declared) > maximumBytes)
  ) {
    cancel(response.body);
    throw new Error('Remote JSON response exceeds its byte limit.');
  }
  if (!response.body) throw new Error('Remote JSON response has no body.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const chunks: string[] = [];
  let bytes = 0;
  let complete = false;
  try {
    while (true) {
      const item = await abortable(reader.read(), signal);
      if (item.done) {
        complete = true;
        break;
      }
      bytes += item.value.byteLength;
      if (bytes > maximumBytes) throw new Error('Remote JSON response exceeds its byte limit.');
      chunks.push(decoder.decode(item.value, { stream: true }));
    }
    chunks.push(decoder.decode());
    if (signal.aborted) throw new Error('Remote JSON observation aborted.');
    const value: unknown = JSON.parse(chunks.join(''));
    return value;
  } finally {
    if (!complete) {
      try {
        void reader.cancel().catch(() => {});
      } catch {
        /* Preserve the original failure. */
      }
    }
    reader.releaseLock();
  }
}

export async function fetchJsonBounded(
  fetcher: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit & { readonly signal: AbortSignal },
  maximumBytes: number,
): Promise<{ readonly ok: boolean; readonly status: number; readonly value: unknown }> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 32 * 1024 * 1024)
    throw new Error('Invalid remote JSON byte limit.');
  if (init.signal.aborted) throw new Error('Remote JSON observation aborted.');
  const response = await abortable(fetcher(input, init), init.signal, (late) => cancel(late.body));
  return {
    ok: response.ok,
    status: response.status,
    value: await responseJson(response, init.signal, maximumBytes),
  };
}
