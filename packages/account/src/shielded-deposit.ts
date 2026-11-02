import { PassportConnectorError } from './errors.js';
import type { Chain, ShieldedCoin } from './ports/index.js';

import { depositInput } from './shielded-deposit-validation.js';
import {
  runRecoverableShieldedDeposit,
  type ShieldedDepositRecovery,
} from './shielded-deposit-recovery.js';

export interface ShieldedDepositRequest {
  readonly account: string;
  /** A stable idempotency key for the sender wallet. */
  readonly requestId: string;
  readonly color: Uint8Array;
  readonly amount: bigint;
  /** The sender supplies this once and retains it across reconciliation. */
  readonly nonce: Uint8Array;
}

export interface ShieldedDepositSender {
  /**
   * Prove and submit the pinned `deposit_shielded` call using a value-bearing sender wallet.
   * Repeated request IDs must never spend twice, even after a timeout or process restart.
   */
  depositShielded(request: {
    readonly requestId: string;
    readonly account: string;
    readonly coin: ShieldedCoin;
    readonly entry: Uint8Array;
    /** Present only for a journalled original intent; bind durable sender lookup to it. */
    readonly intentSha256?: string;
  }): Promise<{ readonly txId: string }>;
}

export interface ShieldedDepositPorts {
  /** Enables original-intent recovery; unjournalled calls are one-shot only. */
  readonly recovery?: ShieldedDepositRecovery;
  readonly chain: Pick<Chain, 'readAccount'>;
  /** Seal a coin to the live ACC enc_key, for example with the mn-passport-keys root export. */
  readonly sealCoin: (encKey: Uint8Array, coin: ShieldedCoin) => Promise<Uint8Array>;
  readonly sender: ShieldedDepositSender;
  readonly pollMs?: number;
  readonly confirmationMs?: number;
  readonly now?: () => number;
  /** Timer supplied by the host so the account core stays platform neutral. */
  readonly sleep: (ms: number) => Promise<void>;
}

export interface ShieldedDepositResult {
  readonly txId: string;
  readonly inboxIndex: number;
  /** The ACC key changed after this sender sealed the coin; older envelopes may be needed. */
  readonly viewingKeyChanged: boolean;
}

const same = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/**
 * Send a shielded coin to the ACC and confirm its encrypted description in the live inbox.
 * The ACC's `receiveShielded` runs in the same call as the inbox insertion. This flow does not
 * have the sender's wallet: the injected sender owns value input, fees, proof and idempotency.
 */
export async function depositShielded(
  request: ShieldedDepositRequest,
  ports: ShieldedDepositPorts,
): Promise<ShieldedDepositResult> {
  if (ports.recovery) return runRecoverableShieldedDeposit(request, ports);
  const { input, pollMs, confirmationMs } = depositInput(request, ports);
  const now = ports.now ?? Date.now;
  const first = await ports.chain.readAccount(input.account, { includeInbox: true });
  if (!first) throw new PassportConnectorError('AccountNotFound', 'The destination ACC is absent.');
  if (first.specVersion !== 3 || !first.booted || !first.encKey || !first.inboxEntries)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'The ACC cannot accept a shielded deposit.',
    );
  if (first.encKey.length !== 32)
    throw new PassportConnectorError('EncryptionKeyMismatch', 'The ACC enc_key is malformed.');

  const initialInboxCount = first.inboxEntries.length;
  const encKey = first.encKey.slice();
  const coin: ShieldedCoin = {
    nonce: input.nonce.slice(),
    color: input.color.slice(),
    value: input.amount,
  };
  const entry = await ports.sealCoin(encKey, coin);
  if (entry.length !== 192)
    throw new PassportConnectorError(
      'InternalError',
      'The coin sealer returned a malformed entry.',
    );
  // A concurrent rotation before submission would seal funds to an obsolete key.
  const beforeSubmit = await ports.chain.readAccount(input.account);
  if (!beforeSubmit?.encKey || !same(beforeSubmit.encKey, encKey))
    throw new PassportConnectorError(
      'EncryptionKeyMismatch',
      'The ACC enc_key changed before deposit.',
    );
  const { txId } = await ports.sender.depositShielded({
    requestId: input.requestId,
    account: input.account,
    coin,
    entry,
  });
  if (!txId)
    throw new PassportConnectorError('InternalError', 'The sender returned no transaction ID.');
  const deadline = now() + confirmationMs;
  for (;;) {
    const current = await ports.chain.readAccount(input.account, { includeInbox: true });
    const index = current?.inboxEntries?.findIndex(
      (candidate, position) => position >= initialInboxCount && same(candidate, entry),
    );
    if (index !== undefined && index >= 0) {
      return {
        txId,
        inboxIndex: index,
        viewingKeyChanged: !current?.encKey || !same(current.encKey, encKey),
      };
    }
    if (now() >= deadline)
      throw new PassportConnectorError(
        'InternalError',
        `Deposit ${txId} was submitted but its ACC inbox entry is unconfirmed; reconcile before retrying.`,
      );
    await ports.sleep(pollMs);
  }
}
