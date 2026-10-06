/** What the HTTP layer needs from the chain; the reference client implements it (reference-backend.ts). */
export interface ChainBackend {
  check(preimage: Uint8Array, keyLocation: string): Promise<(bigint | undefined)[]>;
  prove(
    preimage: Uint8Array,
    keyLocation: string,
    overwriteBindingInput?: bigint,
  ): Promise<Uint8Array>;
  /** Adds the sponsor's fees to a proven, unbalanced transaction; returns the finalized bytes. */
  balance(tx: Uint8Array): Promise<Uint8Array>;
  submit(tx: Uint8Array): Promise<string>;
  /** Wave deployment with constructor inputs only; retires the maintenance authority. */
  deploy(boot: Uint8Array, encKey: Uint8Array): Promise<{ address: string; txHashes: string[] }>;
  sponsorKeys(): { coinPublicKey: string; encryptionPublicKey: string };
}
