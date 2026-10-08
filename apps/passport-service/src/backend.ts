/** What the HTTP layer needs from the chain; the reference client implements it (reference-backend.ts). */
export interface ChainBackend {
  check(preimage: Uint8Array, keyLocation: string): Promise<(bigint | undefined)[]>;
  prove(
    preimage: Uint8Array,
    keyLocation: string,
    overwriteBindingInput?: bigint,
  ): Promise<Uint8Array>;
  /**
   * Proves a whole unproven transaction (serialised with the `'signature', 'pre-proof',
   * 'pre-binding'` markers) and returns the proven, unbound one. midnight-js 5's ledger asks its
   * proving provider for the circuit's key material (`lookupKey`), prover key included, so the
   * browser cannot prove even with a remote `prove`; the service holds the keys and proves here.
   */
  proveTx(tx: Uint8Array): Promise<Uint8Array>;
  /** Adds the sponsor's fees to a proven, unbalanced transaction; returns the finalized bytes. */
  balance(tx: Uint8Array): Promise<Uint8Array>;
  submit(tx: Uint8Array): Promise<string>;
  /**
   * Runs the wave deploy from constructor inputs only, retiring the maintenance authority when the
   * caller asks (D-11). `txHashes` carries each wave's submission id (what `submitTx` returns), not
   * the hash of the transaction as included (Final review M4).
   */
  deploy(
    boot: Uint8Array,
    encKey: Uint8Array,
    retireAuthority: boolean,
  ): Promise<{ address: string; txHashes: string[] }>;
  sponsorKeys(): { coinPublicKey: string; encryptionPublicKey: string };
}
