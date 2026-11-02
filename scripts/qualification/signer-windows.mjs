// Window routing is simulated; request channels are the runtime's actual MessagePorts.
export const SIGNER_DAPP_ORIGIN = 'https://passport-dapp.example';
export const SIGNER_URL = 'http://localhost:18809/signer/';
export const SIGNER_ORIGIN = new URL(SIGNER_URL).origin;

export function createSignerWindowPair() {
  /** @type {Set<(event:any)=>void>} */ const dappListeners = new Set(),
    signerListeners = new Set();
  /** @param {Set<(event:any)=>void>} listeners @param {any} event */
  const emit = (listeners, event) => {
    for (const listener of [...listeners]) listener(event);
  };
  /** @type {Array<{direction:string,targetOrigin:string}>} */
  const posted = [];
  const opener = {
    postMessage(/** @type {unknown} */ data, /** @type {string} */ targetOrigin) {
      posted.push({ direction: 'signer-to-dapp', targetOrigin });
      if (targetOrigin !== '*' && targetOrigin !== SIGNER_DAPP_ORIGIN) return;
      queueMicrotask(() =>
        emit(dappListeners, { data, origin: SIGNER_ORIGIN, source: popup, ports: [] }),
      );
    },
  };
  const popup = {
    closed: false,
    close() {
      popup.closed = true;
    },
    postMessage(
      /** @type {unknown} */ data,
      /** @type {string} */ targetOrigin,
      /** @type {import('node:worker_threads').MessagePort[]} */ transfer = [],
    ) {
      posted.push({ direction: 'dapp-to-signer', targetOrigin });
      if (targetOrigin !== '*' && targetOrigin !== SIGNER_ORIGIN) return;
      queueMicrotask(() =>
        emit(signerListeners, {
          data,
          origin: SIGNER_DAPP_ORIGIN,
          source: opener,
          ports: transfer,
        }),
      );
    },
  };
  const target = (/** @type {Set<(event:any)=>void>} */ listeners) => ({
    addEventListener(/** @type {string} */ _type, /** @type {(event:any)=>void} */ callback) {
      listeners.add(callback);
    },
    removeEventListener(/** @type {string} */ _type, /** @type {(event:any)=>void} */ callback) {
      listeners.delete(callback);
    },
  });
  return {
    dappHost: { ...target(dappListeners), open: () => popup },
    signerHost: {
      ...target(signerListeners),
      opener,
      location: { origin: SIGNER_ORIGIN, hostname: 'localhost' },
      document: { referrer: SIGNER_DAPP_ORIGIN + '/' },
    },
    popup,
    opener,
    posted,
    emitDapp: (/** @type {any} */ event) => emit(dappListeners, event),
    emitSigner: (/** @type {any} */ event) => emit(signerListeners, event),
    listenerCounts: () => ({ dapp: dappListeners.size, signer: signerListeners.size }),
  };
}
