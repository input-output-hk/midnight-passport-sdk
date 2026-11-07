import '../../src/polyfills.js';
// This query deliberately bypasses the synthetic-runtime test plugin.
const path = '/src/wallet/runtime.ts?quality-real=1';
const runtime = await import(path);
postMessage({
  imported: typeof runtime.createWalletRuntime === 'function',
  worker: typeof document === 'undefined',
});
