import type { UnshieldedGrantContext } from '../grant-holder.js';

/** Authorization and settlement fields from one verified ACC ledger snapshot. */
export interface LiveP256GrantSpendContext extends UnshieldedGrantContext {
  readonly grantEpoch: bigint;
  readonly deviceEpoch: bigint;
  readonly grantGeneration: bigint;
  readonly generation: bigint;
  readonly rpCommit: Uint8Array;
  readonly callerCommit: Uint8Array;
  readonly read: boolean;
  readonly withdrawShielded: boolean;
  readonly withdrawShieldedToContract: boolean;
}

export interface P256GrantSpendSource {
  readP256GrantSpendContext(
    account: string,
    grantId: string,
  ): Promise<LiveP256GrantSpendContext | undefined>;
}
