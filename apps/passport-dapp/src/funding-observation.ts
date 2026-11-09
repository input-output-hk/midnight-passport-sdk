/** Own the deadline through response decoding, even for an injected fetch that ignores abort. */
export async function fundingObservation(
  fetch: (
    url: string,
    init?: { signal?: AbortSignal },
  ) => Promise<{
    readonly ok: boolean;
    json(): Promise<unknown>;
  }>,
  url: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<unknown> {
  const request = new AbortController();
  const abort = () => request.abort();
  const cancelled = new Promise<never>((_, reject) => {
    request.signal.addEventListener('abort', () => reject(Error('ACC balance read unavailable')), {
      once: true,
    });
  });
  signal.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(abort, timeoutMs);
  if (signal.aborted) abort();
  try {
    return await Promise.race([
      (async () => {
        if (request.signal.aborted) throw Error('ACC balance read unavailable');
        const response = await fetch(url, { signal: request.signal });
        if (!response.ok) throw Error('ACC balance read unavailable');
        return response.json();
      })(),
      cancelled,
    ]);
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener('abort', abort);
  }
}

export function fundingPause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}
