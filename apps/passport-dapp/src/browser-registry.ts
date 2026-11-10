import type { DevWallet } from './wallet/dev-wallet.js';

declare global {
  interface Window {
    midnight?: Record<string, unknown>;
  }
}

/** Publish only the explicitly connected demo descriptor, never seeds or ACC authority. */
export function publishDemoWallet(wallet: DevWallet): void {
  const registry = (window.midnight ??= {});
  registry.devwallet = wallet.descriptor;
}
