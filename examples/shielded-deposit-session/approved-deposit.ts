import {
  depositShielded,
  resumeShieldedDeposit,
  type ShieldedDepositPins,
  type ShieldedDepositRequest,
  type ShieldedDepositPorts,
  type ShieldedDepositRecovery,
} from '@input-output-hk/mn-passport-account';
import type { MutationByteStore, PrfKeySource } from '@input-output-hk/mn-passport-account/ports';
import { encryptedShieldedDepositJournal } from '@input-output-hk/mn-passport-keys';

/**
 * Example host composition, not an authorization layer. The host must obtain consent for each
 * original account/network/intent, bound injected I/O, and serialize or isolate unrelated uses of
 * this key source. An overlapping WebAuthn source session is not account-isolated by this helper.
 * Keep the same protected source, durable store, pins and wallet records after process loss.
 */
export function approvedDepositOperations(input: {
  readonly pins: ShieldedDepositPins;
  readonly journalKeySource: PrfKeySource;
  readonly store: MutationByteStore;
  readonly senderPorts: Omit<ShieldedDepositPorts, 'recovery'>;
  readonly evidence: Pick<ShieldedDepositRecovery, 'reconcileSender' | 'confirmTransaction'>;
}) {
  const { pins, journalKeySource, store, senderPorts, evidence } = input;
  const journal = encryptedShieldedDepositJournal(pins, journalKeySource, store);
  const ports = { ...senderPorts, recovery: { pins, journal, ...evidence } };
  return {
    // Each invocation has its own caller-approved scope. Neither method retries a failed send.
    deposit: (originalRequest: ShieldedDepositRequest) =>
      journalKeySource.withSession(() => depositShielded(originalRequest, ports)),
    resume: (originalRequest: ShieldedDepositRequest) =>
      journalKeySource.withSession(() => resumeShieldedDeposit(originalRequest, ports)),
  };
}
