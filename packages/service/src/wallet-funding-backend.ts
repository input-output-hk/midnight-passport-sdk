import { setTimeout as delay } from 'node:timers/promises';
import type { ServiceWire } from '@input-output-hk/mn-passport-protocol';
import type { FundingBackend } from './funding-route.js';
import { serial } from './queue.js';

export interface FundingAccount {
  ledgerState(): Promise<{
    readonly spec_version: bigint;
    readonly unshielded_balances: {
      member(color: Uint8Array): boolean;
      lookup(color: Uint8Array): bigint;
    };
  }>;
  depositUnshielded(color: Uint8Array, amount: bigint): Promise<{ readonly txId: string }>;
}

export interface WalletFundingOptions {
  /** This allowlist is populated from the sponsor's pinned wave-deployment log. */
  readonly deployed: (address: string) => boolean;
  /** Connect through the pinned ACC compiled contract using the dedicated funding wallet. */
  readonly connect: (address: string) => Promise<FundingAccount>;
  readonly pollMs?: number;
  readonly confirmationMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/** The wallet path behind the isolated funding route; no fee-sponsor method is reused. */
export function createWalletFundingBackend(
  options: WalletFundingOptions,
): FundingBackend & { eligible(address: string): Promise<boolean> } {
  const runExclusive = serial(8);
  const pollMs = options.pollMs ?? 2000;
  const confirmationMs = options.confirmationMs ?? 120_000;
  if (pollMs < 1 || confirmationMs < pollMs) throw new Error('invalid funding confirmation window');
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => delay(ms));

  const accountFor = async (address: string): Promise<FundingAccount | undefined> => {
    if (!options.deployed(address)) return undefined;
    const account = await options.connect(address);
    if ((await account.ledgerState()).spec_version !== 2n) return undefined;
    return account;
  };
  const balance = async (account: FundingAccount, color: Uint8Array): Promise<bigint> => {
    const ledger = await account.ledgerState();
    if (ledger.spec_version !== 2n) throw new Error('ACC binding changed during funding');
    return ledger.unshielded_balances.member(color) ? ledger.unshielded_balances.lookup(color) : 0n;
  };

  return {
    eligible: async (address) => (await accountFor(address)) !== undefined,
    fund: (request: ServiceWire.FundAccRequest) =>
      runExclusive(async () => {
        const account = await accountFor(request.accountAddress);
        if (!account) throw new Error('ACC is not an eligible deployed binding');
        if (!/^[0-9a-f]{64}$/.test(request.color) || !/^[1-9][0-9]*$/.test(request.amount))
          throw new Error('invalid unshielded deposit');
        const color = Uint8Array.from(Buffer.from(request.color, 'hex'));
        const amount = BigInt(request.amount);
        if (amount > (1n << 128n) - 1n) throw new Error('deposit exceeds Uint128');
        const before = await balance(account, color);
        const { txId } = await account.depositUnshielded(color, amount);
        if (!txId) throw new Error('deposit returned no transaction ID');
        const deadline = now() + confirmationMs;
        for (;;) {
          const credited = await balance(account, color);
          if (credited >= before + amount)
            return { requestId: request.requestId, txId, creditedBalance: credited.toString() };
          if (now() >= deadline) throw new Error('ACC credit was not confirmed in time');
          await sleep(pollMs);
        }
      }),
  };
}
