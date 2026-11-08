import type { FetchLike } from '@input-output-hk/mn-passport-account/ports';
import { boundedJson } from './bounded-json.js';

type Response = Awaited<ReturnType<FetchLike>>;
type Reader = ReturnType<NonNullable<Response['body']>['getReader']>;

function cancelReader(reader: Reader): void {
  try {
    void reader.cancel().catch(() => undefined);
  } catch {
    /* Structural transports may throw synchronously. */
  }
  try {
    reader.releaseLock();
  } catch {
    /* A still-pending read may temporarily retain its lock. */
  }
}
function cancelResponse(response: Response): void {
  try {
    const reader = response.body?.getReader();
    if (reader) cancelReader(reader);
  } catch {
    /* Best effort for a closed, locked, or custom body. */
  }
}

/** Own one response, including headers which arrive after its observation was abandoned.
 * No default size policy: structural json() owns its allocations and synchronous work. */
export function responseOwner(signal: AbortSignal) {
  let response: Response | undefined;
  let reader: Reader | undefined;
  let disposed = false;
  let finished = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    signal.removeEventListener('abort', dispose);
    if (reader) cancelReader(reader);
    else if (response && !finished) cancelResponse(response);
  };
  signal.addEventListener('abort', dispose, { once: true });
  if (signal.aborted) dispose();
  return {
    adopt(current: Response) {
      if (disposed) {
        cancelResponse(current);
        throw new Error('Response observation ended.');
      }
      response = current;
    },
    async json(maximum?: number): Promise<unknown> {
      const current = response;
      if (disposed || !current) throw new Error('Response observation ended.');
      const body = current.body;
      const wrapped = {
        ok: current.ok,
        status: current.status,
        json: () => current.json(),
        ...(current.headers && { headers: current.headers }),
        ...(body && {
          body: {
            getReader() {
              reader = body.getReader();
              return reader;
            },
          },
        }),
      };
      if (maximum !== undefined) {
        const value = await boundedJson(wrapped, maximum);
        finished = true;
        reader = undefined;
        return value;
      }
      if (!body) {
        const value = await current.json();
        finished = true;
        return value;
      }
      reader = body.getReader();
      const active = reader;
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let text = '';
      try {
        for (;;) {
          const next = await active.read();
          if (disposed) throw new Error('Response observation ended.');
          if (next.done) break;
          if (!(next.value instanceof Uint8Array)) throw new Error('Invalid response chunk.');
          text += decoder.decode(next.value, { stream: true });
        }
        text += decoder.decode();
        const value: unknown = JSON.parse(text);
        finished = true;
        return value;
      } finally {
        if (finished || disposed) {
          active.releaseLock();
          reader = undefined;
        }
      }
    },
    dispose,
  };
}
