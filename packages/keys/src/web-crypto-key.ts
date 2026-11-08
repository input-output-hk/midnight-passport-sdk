/** Use the supplied runtime's WebCrypto type, without requiring DOM's global
 * CryptoKey name in Node source consumers. This creates no key or crypto runtime. */
export type WebCryptoKey = Awaited<ReturnType<typeof globalThis.crypto.subtle.importKey>>;
