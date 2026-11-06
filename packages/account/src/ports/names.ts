/** A name is scoped to one provider namespace and one Midnight network, never a wallet seed. */
export interface PassportNameQuery {
  /** Exact, provider-defined spelling. Normalisation belongs to the provider/host. */
  readonly name: string;
  readonly networkId: string;
}

export interface PassportNameRecord extends PassportNameQuery {
  readonly namespace: string;
  /** Lowercase 32-byte ACC address hex; not an HD wallet receiving address. */
  readonly accountAddress: string;
  /** Optional expiry, in Unix epoch milliseconds. Absence is not a permanence guarantee. */
  readonly expiresAt?: number;
}

export interface PassportNameProvider {
  readonly id: string;
  readonly namespace: string;
  /** Presentation metadata from trusted host configuration, not an authenticity proof. */
  readonly mode: 'mock' | 'external';
}

/**
 * Read-only naming seam. No credential, grant, transaction or registration methods.
 * Return undefined only for an absent name; throw on transport/provider failure.
 * Use account/names' resolvePassportName to check scope, shape and expiry before display.
 */
export interface PassportNameService {
  readonly provider: PassportNameProvider;
  resolve(query: PassportNameQuery): Promise<PassportNameRecord | undefined>;
}
