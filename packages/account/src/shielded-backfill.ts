import type { FlowOptions } from '@input-output-hk/mn-passport-protocol';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { z } from 'zod';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { encodeMutationValue, mutationDigest } from './mutation-codec.js';
import type {
  AccountHint,
  Authoriser,
  PinnedChain,
  QualifiedShieldedCoin,
  ShieldedCoin,
} from './ports/index.js';
import {
  backfillCircuit,
  backfillUnsettled,
  parseBackfillRecord,
  readBackfillArguments,
  type ShieldedBackfillJournal,
  type ShieldedBackfillRecord,
} from './shielded-backfill-journal.js';
import { signShieldedBackfill, type ShieldedBackfillPure } from './shielded-backfill-sign.js';
import { shieldedEffectHex } from './shielded-withdrawal-journal.js';
import {
  recoverShieldedWithdrawal,
  type ShieldedWithdrawalRecoveryPorts,
} from './shielded-withdrawal-recovery.js';

const observation = z.strictObject({
  appendId: z.uuid(),
  intentSha256: shieldedEffectHex,
  account: shieldedEffectHex,
  circuit: backfillCircuit,
  callArgsSha256: shieldedEffectHex,
  entrySha256: shieldedEffectHex,
  txHash: shieldedEffectHex,
  inboxIndex: z.number().int().min(0).max(4095),
});

export interface ShieldedBackfillFinalitySource {
  readonly networkId: string;
  readonly bindingId: 'acc-s3r1.1';
  /**
   * Independently observe the exact original append transaction by durable
   * request correlation. Verify successful finality, signed arguments and
   * actual appended entry and index. Return undefined for uncertain results.
   */
  readOriginalAppend(request: {
    readonly appendId: string;
    readonly intentSha256: string;
  }): Promise<z.input<typeof observation> | undefined>;
}

export interface ShieldedBackfillRecoveryPorts {
  readonly withdrawal: ShieldedWithdrawalRecoveryPorts;
  readonly chain: Pick<PinnedChain, 'readAccount' | 'networkId' | 'bindingId'>;
  readonly journal: ShieldedBackfillJournal;
  readonly appendFinality: ShieldedBackfillFinalitySource;
}

type CheckUnspentChange = (account: string, coin: QualifiedShieldedCoin) => Promise<boolean>;

export interface ShieldedBackfillResumePorts extends ShieldedBackfillRecoveryPorts {
  readonly isUnspent: CheckUnspentChange;
  readonly reviewResume: (input: {
    readonly networkId: string;
    readonly bindingId: 'acc-s3r1.1';
    readonly account: string;
    readonly color: string;
    readonly amount: string;
    readonly withdrawalTxHash: string;
    readonly appendId: string;
    readonly intentSha256: string;
  }) => Promise<boolean>;
  /** The same host dispatch store must fence both the original and its resumption. */
  readonly resumeOriginalAppend: (input: {
    readonly original: ShieldedBackfillRecord;
    readonly intentSha256: string;
    readonly args: readonly unknown[];
    readonly signal?: FlowOptions['signal'];
  }) => Promise<unknown>;
}

export interface ShieldedBackfillPorts extends ShieldedBackfillRecoveryPorts {
  readonly chain: PinnedChain;
  readonly owner: AccountHint;
  readonly authoriser: Authoriser;
  readonly pure: ShieldedBackfillPure;
  readonly sealCoin: (encKey: Uint8Array, coin: ShieldedCoin) => Promise<Uint8Array>;
  /** Confirm this exact qualified ACC output remains unspent using current chain evidence. */
  readonly isUnspent: CheckUnspentChange;
  readonly review: (input: {
    readonly account: string;
    readonly withdrawalTxHash: string;
    readonly color: string;
    readonly amount: string;
  }) => Promise<boolean>;
}

export type ShieldedBackfillRecovery =
  | { readonly kind: 'unknown' }
  | {
      readonly kind: 'confirmed';
      readonly requestId: string;
      readonly appendId: string;
      readonly txHash: string;
      readonly inboxIndex: number;
    };

function pins({ chain, withdrawal, appendFinality }: ShieldedBackfillRecoveryPorts) {
  const { networkId, bindingId } = withdrawal.finality;
  if (chain.networkId !== networkId || appendFinality.networkId !== networkId)
    throw new PassportConnectorError(
      'NetworkMismatch',
      'Shielded change uses a different network.',
    );
  if (
    bindingId !== 'acc-s3r1.1' ||
    chain.bindingId !== bindingId ||
    appendFinality.bindingId !== bindingId
  )
    throw new PassportConnectorError('BindingUnsupported', 'Shielded change requires acc-s3r1.1.');
  return networkId;
}

async function originalChange(requestId: string, ports: ShieldedBackfillRecoveryPorts) {
  const networkId = pins(ports);
  const change = await recoverShieldedWithdrawal(requestId, ports.withdrawal);
  if (change.kind !== 'change-found' || pins(ports) !== networkId) return undefined;
  const slot = { networkId, account: change.account, commitment: change.changeCommitment };
  return { slot, change };
}

function appendRequest(record: ShieldedBackfillRecord) {
  return Object.freeze({ appendId: record.appendId, intentSha256: mutationDigest(record) });
}

function newAppendId(): string {
  const raw = toHex(randomBytes(16));
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-4${raw.slice(13, 16)}-8${raw.slice(17, 20)}-${raw.slice(20)}`;
}

async function observe(
  stored: ShieldedBackfillRecord,
  ports: ShieldedBackfillRecoveryPorts,
  acknowledgedHash?: string,
): Promise<ShieldedBackfillRecovery> {
  const record = parseBackfillRecord(stored);
  if (pins(ports) !== record.networkId) return { kind: 'unknown' };
  const request = appendRequest(record);
  const result = observation.safeParse(await ports.appendFinality.readOriginalAppend(request));
  if (!result.success) return { kind: 'unknown' };
  const seen = result.data;
  if (
    seen.appendId !== request.appendId ||
    seen.intentSha256 !== request.intentSha256 ||
    seen.account !== record.account ||
    seen.circuit !== record.circuit ||
    seen.callArgsSha256 !== record.callArgsSha256 ||
    seen.entrySha256 !== toHex(sha256(fromHex(record.entry))) ||
    seen.inboxIndex < record.minInboxIndex ||
    (acknowledgedHash !== undefined && seen.txHash !== acknowledgedHash)
  )
    return { kind: 'unknown' };
  const view = await ports.chain.readAccount(record.account, { includeInbox: true });
  const entry = view?.inboxEntries?.[seen.inboxIndex];
  if (
    pins(ports) !== record.networkId ||
    !view?.booted ||
    view.specVersion !== 3 ||
    !entry ||
    toHex(entry) !== record.entry
  )
    return { kind: 'unknown' };
  return {
    kind: 'confirmed',
    requestId: record.withdrawalId,
    appendId: record.appendId,
    txHash: seen.txHash,
    inboxIndex: seen.inboxIndex,
  };
}

async function retainedAppend(
  { slot, change }: NonNullable<Awaited<ReturnType<typeof originalChange>>>,
  journal: ShieldedBackfillJournal,
) {
  const value = await journal.read(slot);
  if (!value) return undefined;
  const record = parseBackfillRecord(value);
  if (
    record.networkId !== slot.networkId ||
    record.account !== slot.account ||
    record.commitment !== slot.commitment ||
    record.withdrawalId !== change.requestId ||
    record.withdrawalTxHash !== change.txHash
  )
    return undefined;
  return record;
}

/** Reconcile the original append without a signer, sealer or submission port. */
export async function recoverShieldedBackfill(
  requestId: string,
  ports: ShieldedBackfillRecoveryPorts,
): Promise<ShieldedBackfillRecovery> {
  const original = await originalChange(requestId, ports);
  const record = original && (await retainedAppend(original, ports.journal));
  return record ? observe(record, ports) : { kind: 'unknown' };
}

/** Resume the approved original through the same host dispatch fence. */
export async function resumeShieldedBackfill(
  requestId: string,
  ports: ShieldedBackfillResumePorts,
  options: Pick<FlowOptions, 'signal'> = {},
): Promise<ShieldedBackfillRecovery> {
  const { signal } = options;
  const flow = { ...(signal && { signal }) };
  checkpoint(flow);
  const original = await originalChange(requestId, ports);
  if (!original) return { kind: 'unknown' };
  const record = await retainedAppend(original, ports.journal);
  if (!record) return { kind: 'unknown' };
  const observed = await observe(record, ports);
  if (observed.kind === 'confirmed') return observed;
  const continuation = await ports.journal.readContinuation?.(original.slot);
  if (!continuation) return { kind: 'unknown' };
  const { deviceEpoch, authNonce, deviceEntry } = continuation;
  const args = readBackfillArguments(record, continuation);
  const { appendId, intentSha256 } = appendRequest(record);
  const { account, withdrawalTxHash } = record;
  checkpoint(flow);
  if (
    !(await ports.reviewResume(
      Object.freeze({
        networkId: record.networkId,
        bindingId: 'acc-s3r1.1',
        account,
        color: toHex(original.change.change.color),
        amount: original.change.change.value.toString(),
        withdrawalTxHash,
        appendId,
        intentSha256,
      }),
    ))
  )
    throw new PassportConnectorError('UserCancelled', 'Shielded backfill resume was declined.');
  checkpoint(flow);
  if (!(await ports.isUnspent(account, original.change.change))) return { kind: 'unknown' };
  const current = await liveView(ports.chain, account);
  if (
    pins(ports) !== record.networkId ||
    current.key !== record.encKey ||
    current.count !== record.minInboxIndex ||
    current.epoch.toString() !== deviceEpoch ||
    current.nonce.toString() !== authNonce ||
    !current.view.hasEntry(fromHex(deviceEntry))
  )
    return { kind: 'unknown' };
  checkpoint(flow);
  try {
    await ports.resumeOriginalAppend({
      original: record,
      intentSha256,
      args,
      ...flow,
    });
  } catch {
    // The original may have reached the host. Only observation can confirm it.
  }
  return observe(record, ports);
}

function checkpoint(options: FlowOptions) {
  if (options.signal?.aborted)
    throw new PassportConnectorError('Aborted', 'Shielded backfill cancelled.');
}

async function liveView(chain: ShieldedBackfillRecoveryPorts['chain'], account: string) {
  const view = await chain.readAccount(account, { includeInbox: true, includeDevices: true });
  if (
    !view?.booted ||
    view.specVersion !== 3 ||
    view.encKey?.length !== 32 ||
    !view.inboxEntries ||
    view.inboxEntries.length >= 4096
  )
    return backfillUnsettled();
  return {
    view,
    key: toHex(view.encKey),
    count: view.inboxEntries.length,
    epoch: view.deviceEpoch,
    nonce: view.authNonce,
  };
}

/** Seal verified, unspent change and reserve one original owner-authorized append. */
export async function appendShieldedChange(
  requestId: string,
  ports: ShieldedBackfillPorts,
  options: FlowOptions = {},
): Promise<Extract<ShieldedBackfillRecovery, { kind: 'confirmed' }>> {
  checkpoint(options);
  const original = await originalChange(requestId, ports);
  if (!original) return backfillUnsettled();
  const { slot, change } = original;
  const { chain, journal, authoriser, pure } = ports;
  const owner = {
    ...ports.owner,
    publicKey: { ...ports.owner.publicKey },
    ...(ports.owner.credentialId && { credentialId: Uint8Array.from(ports.owner.credentialId) }),
    ...(ports.owner.policy && {
      policy: {
        origin: Uint8Array.from(ports.owner.policy.origin),
        rp_id_hash: Uint8Array.from(ports.owner.policy.rp_id_hash),
      },
    }),
  };
  if (
    owner.address !== slot.account ||
    owner.status !== 'active' ||
    (owner.scheme !== 'p256-webauthn' && owner.scheme !== 'jubjub-schnorr') ||
    owner.scheme !== authoriser.scheme ||
    !authoriser.withKeySession
  )
    throw new PassportConnectorError('NotAuthorised', 'An active owner session is required.');
  if (await journal.read(slot)) return backfillUnsettled();
  const coin = () => ({
    nonce: Uint8Array.from(change.change.nonce),
    color: Uint8Array.from(change.change.color),
    value: change.change.value,
    mt_index: change.change.mt_index,
  });
  if (!(await ports.isUnspent(slot.account, coin()))) return backfillUnsettled();
  const first = await liveView(chain, slot.account);
  checkpoint(options);
  const approved = await ports.review(
    Object.freeze({
      account: slot.account,
      withdrawalTxHash: change.txHash,
      color: toHex(change.change.color),
      amount: change.change.value.toString(),
    }),
  );
  if (!approved)
    throw new PassportConnectorError('UserCancelled', 'Shielded backfill was declined.');
  const recheck = async () => {
    const latest = await liveView(chain, slot.account);
    if (
      pins(ports) !== slot.networkId ||
      latest.key !== first.key ||
      latest.count !== first.count ||
      latest.epoch !== first.epoch ||
      latest.nonce !== first.nonce
    )
      return backfillUnsettled();
    checkpoint(options);
    return latest.view;
  };
  return authoriser.withKeySession(
    async () => {
      await recheck();
      const { nonce, color, value } = coin();
      const sealed = await ports.sealCoin(fromHex(first.key), { nonce, color, value });
      if (!(sealed instanceof Uint8Array) || sealed.length !== 192) return backfillUnsettled();
      const entry = toHex(sealed);
      const view = await recheck();
      const signed = await signShieldedBackfill(owner, authoriser, pure, view, entry);
      if (!(await ports.isUnspent(slot.account, coin()))) return backfillUnsettled();
      await recheck();
      const record = parseBackfillRecord({
        ...slot,
        version: 1,
        withdrawalId: change.requestId,
        withdrawalTxHash: change.txHash,
        appendId: newAppendId(),
        circuit: signed.circuit,
        entry,
        encKey: first.key,
        minInboxIndex: first.count,
        callArgsSha256: mutationDigest(signed.args),
      });
      if (
        !(await journal.reserve(record, {
          intentSha256: mutationDigest(record),
          signedArgs: JSON.stringify(encodeMutationValue(signed.args)),
          deviceEntry: toHex(signed.deviceEntry),
          deviceEpoch: first.epoch.toString(),
          authNonce: first.nonce.toString(),
        }))
      )
        return backfillUnsettled();
      if (!(await ports.isUnspent(slot.account, coin()))) return backfillUnsettled();
      await recheck();
      const request = appendRequest(record);
      try {
        const tx = await chain.call({
          address: slot.account,
          circuit: signed.circuit,
          args: signed.args,
          mutation: { requestId: request.appendId, intentSha256: request.intentSha256 },
          ...(options.signal && { signal: options.signal }),
          ...(options.onEvent && { onEvent: options.onEvent }),
        });
        const result = await observe(record, ports, tx.txHash);
        return result.kind === 'confirmed' ? result : backfillUnsettled();
      } catch {
        return backfillUnsettled();
      }
    },
    { kind: 'backfill-shielded-change', account: slot.account },
  );
}
