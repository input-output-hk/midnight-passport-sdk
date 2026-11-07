import type { BackgroundPort } from '@input-output-hk/mn-passport-account/ports';

/** The subset shared by dedicated Workers and MessagePorts; inject the owned close action. */
export interface BrowserMessageEndpoint {
  postMessage(message: unknown): void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}
export function browserBackgroundPort(
  endpoint: BrowserMessageEndpoint,
  close: () => void,
): BackgroundPort {
  return {
    post: (message) => endpoint.postMessage(message),
    subscribe(receive, fail) {
      const onMessage: EventListener = (event) => receive((event as MessageEvent<unknown>).data);
      const onFailure: EventListener = () => fail();
      endpoint.addEventListener('message', onMessage);
      endpoint.addEventListener('error', onFailure);
      endpoint.addEventListener('messageerror', onFailure);
      return () => {
        endpoint.removeEventListener('message', onMessage);
        endpoint.removeEventListener('error', onFailure);
        endpoint.removeEventListener('messageerror', onFailure);
      };
    },
    close,
  };
}
