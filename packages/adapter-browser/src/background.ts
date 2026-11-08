import type { BackgroundPort } from '@input-output-hk/mn-passport-account/ports';

/** The subset shared by dedicated Workers and MessagePorts; inject the owned close action. */
export interface BrowserMessageEndpoint {
  postMessage(message: unknown): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
  /** MessagePorts need explicit startup with addEventListener; Workers do not. */
  start?(): void;
}

/** Structural void callbacks can return promises; observe only their result so
 * synchronous cleanup errors retain their original invocation boundaries. */
async function observeCleanupResult(result: unknown): Promise<void> {
  try {
    await result;
  } catch {
    // Teardown remains best effort and never delays channel closure.
  }
}

export function browserBackgroundPort(
  endpoint: BrowserMessageEndpoint,
  close: () => void,
): BackgroundPort {
  let closed = false;
  const closeOwned = () => {
    if (closed) return;
    closed = true;
    void observeCleanupResult(close());
  };
  return {
    post: (message) => endpoint.postMessage(message),
    subscribe(receive, fail) {
      const onMessage: EventListener = (event) => receive((event as MessageEvent<unknown>).data);
      const onFailure: EventListener = () => fail();
      const listeners = [
        ['message', onMessage],
        ['error', onFailure],
        ['messageerror', onFailure],
      ] as const;
      const unsubscribe = () => {
        for (const [type, listener] of listeners) {
          try {
            void observeCleanupResult(endpoint.removeEventListener(type, listener));
          } catch {
            /* Continue releasing the remaining owned listeners. */
          }
        }
      };
      try {
        for (const [type, listener] of listeners) endpoint.addEventListener(type, listener);
        endpoint.start?.();
      } catch {
        unsubscribe();
        try {
          closeOwned();
        } catch {
          /* The failure callback still needs to release pending client work. */
        }
        fail();
      }
      return unsubscribe;
    },
    close: closeOwned,
  };
}
