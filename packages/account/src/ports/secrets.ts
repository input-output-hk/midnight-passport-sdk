/** Secret custody is supplied by the host. No dependency on DOM, Node, React or Lace. */
export interface SecretReference {
  readonly namespace: string;
  readonly networkId: string;
  readonly bindingId: string;
  readonly account: string;
  readonly id: string;
}

export interface StoredSecret {
  /** Opaque version for compare-and-swap; not a timestamp or an authentication token. */
  readonly version: string;
  /** Caller-owned copy. The caller must dispose it when finished. */
  readonly bytes: Uint8Array;
}

/**
 * Atomic per-reference operations. Implementations copy inputs before their first await.
 * Different scopes must never alias. No listing API or implicit credential ceremonies.
 * Reads and successful writes return owned copies. Missing != unavailable.
 */
export interface SecretStore {
  readonly capabilities: {
    readonly persistence: 'memory' | 'persistent';
    readonly protection: 'none' | 'host-managed';
    /** Acknowledged writes use the backend's strict commit guarantee. */
    readonly writeDurability?: 'strict';
  };
  read(reference: SecretReference): Promise<StoredSecret | undefined>;
  /** null means create only. An opaque version means replace exactly that version. */
  write(
    reference: SecretReference,
    bytes: Uint8Array,
    expectedVersion: string | null,
  ): Promise<StoredSecret>;
  /** Remove only the reviewed version. An absent or changed record is a conflict. */
  remove(reference: SecretReference, expectedVersion: string): Promise<void>;
  /** Local handle teardown only; does not delete persisted values or revoke chain authority. */
  close(): void;
}
