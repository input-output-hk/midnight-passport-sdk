import {
  depositShielded,
  resumeShieldedDeposit,
  shieldedDepositPinsHash,
  type ShieldedDepositDocument,
  type RecoverableShieldedDepositPorts,
  type ShieldedDepositPins,
  type ShieldedDepositPorts,
  type ShieldedDepositRecovery,
  type ShieldedDepositRequest,
  type ShieldedDepositResult,
} from '@input-output-hk/mn-passport-account';
import type { MutationByteStore, PrfKeySource } from '@input-output-hk/mn-passport-account/ports';
import { encryptedShieldedDepositJournal } from '@input-output-hk/mn-passport-keys';

/** Private host review, NOT a public operation log or an owner-circuit FlowDescriptor. */
export interface DepositReview {
  readonly kind: 'deposit-shielded';
  readonly action: 'start' | 'reconcile';
  readonly origin: string;
  readonly senderLabel: string;
  readonly requestId: string;
  readonly account: string;
  readonly color: string;
  readonly amountBaseUnits: string;
  readonly pins: ShieldedDepositPins;
  readonly keyPurpose: 'unlock-protected-deposit-journal';
  readonly mayInvokeSender: boolean;
}

/** Safe for a host-owned operation panel; identifiers still have correlation/privacy costs. */
export interface DepositStatus {
  readonly requestId: string;
  readonly state: 'idle' | 'working' | 'declined' | 'unresolved' | 'confirmed' | 'busy';
  readonly code:
    | 'AwaitingReview'
    | 'OperationInProgress'
    | 'ApprovalDeclined'
    | 'ApprovalUnavailable'
    | 'OriginalEvidenceRequired'
    | 'DepositUnsettled'
    | 'DepositConfirmed';
  readonly message: string;
  readonly txId?: string;
  readonly receipt?: Readonly<ShieldedDepositResult>;
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const validTx = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9:._~+/%=-]{1,256}$/.test(value);

/**
 * One original intent per controller. Hosts must retain its private request, protected journal,
 * sender records and key origin across restarts. This is an example, not a native sender adapter,
 * distributed wallet lock, credential-isolation layer, or public consent API.
 */
export function reviewedDepositOperations(input: {
  readonly originalRequest: ShieldedDepositRequest;
  readonly pins: ShieldedDepositPins;
  readonly journalKeySource: PrfKeySource;
  readonly store: MutationByteStore;
  readonly senderPorts: Omit<ShieldedDepositPorts, 'recovery'>;
  readonly evidence: Pick<ShieldedDepositRecovery, 'reconcileSender' | 'confirmTransaction'>;
  /** Derive these from the host's trusted configuration, never a caller-supplied deep link. */
  readonly origin: string;
  readonly senderLabel: string;
  readonly approve: (review: Readonly<DepositReview>) => Promise<boolean>;
  readonly onStatus?: (status: Readonly<DepositStatus>) => void | Promise<void>;
}) {
  const original = {
    account: input.originalRequest.account,
    requestId: input.originalRequest.requestId,
    color: input.originalRequest.color.slice(),
    nonce: input.originalRequest.nonce.slice(),
    amount: input.originalRequest.amount,
  };
  if (
    !/^[0-9a-f]{64}$/.test(original.account) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(original.requestId) ||
    !(original.color instanceof Uint8Array) ||
    !(original.nonce instanceof Uint8Array) ||
    original.color.length !== 32 ||
    original.nonce.length !== 32 ||
    typeof original.amount !== 'bigint' ||
    original.amount < 1n ||
    original.amount > (1n << 128n) - 1n
  )
    throw new Error('Invalid original deposit request.');
  const pins = Object.freeze({
    networkId: input.pins.networkId,
    bindingId: input.pins.bindingId,
    manifestSha256: input.pins.manifestSha256,
  });
  shieldedDepositPinsHash(pins);
  const origin = new URL(input.origin);
  if (
    origin.origin !== input.origin ||
    !(
      origin.protocol === 'https:' ||
      (origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))
    ) ||
    !/^[a-zA-Z0-9 ._-]{1,80}$/.test(input.senderLabel)
  )
    throw new Error('Use a trusted canonical host origin and sender label.');
  const reviewBase = Object.freeze({
    kind: 'deposit-shielded' as const,
    origin: origin.origin,
    senderLabel: input.senderLabel,
    requestId: original.requestId,
    account: original.account,
    color: hex(original.color),
    amountBaseUnits: original.amount.toString(),
    pins,
    keyPurpose: 'unlock-protected-deposit-journal' as const,
  });
  // Capture configured methods now; replacing a port property during approval cannot switch it.
  const source = input.journalKeySource;
  const session = source.withSession.bind(source);
  const journal = encryptedShieldedDepositJournal(
    pins,
    {
      withSession: session,
      deriveSecret: source.deriveSecret.bind(source),
      deviceSecret: source.deviceSecret.bind(source),
    },
    {
      read: input.store.read.bind(input.store),
      compareAndSwap: input.store.compareAndSwap.bind(input.store),
    },
  );
  const senderPorts = input.senderPorts;
  const readAccount = senderPorts.chain.readAccount.bind(senderPorts.chain);
  const sealCoin = senderPorts.sealCoin.bind(senderPorts);
  const send = senderPorts.sender.depositShielded.bind(senderPorts.sender);
  const lookup = input.evidence.reconcileSender.bind(input.evidence);
  const confirm = input.evidence.confirmTransaction.bind(input.evidence);
  const approve = input.approve;
  const observer = input.onStatus;
  const timing = {
    ...(senderPorts.pollMs === undefined ? {} : { pollMs: senderPorts.pollMs }),
    ...(senderPorts.confirmationMs === undefined
      ? {}
      : { confirmationMs: senderPorts.confirmationMs }),
    ...(senderPorts.now === undefined ? {} : { now: senderPorts.now.bind(senderPorts) }),
    sleep: senderPorts.sleep.bind(senderPorts),
  };
  let busy = false;
  let started = false;
  let txId: string | undefined;
  const makeStatus = (
    state: DepositStatus['state'],
    code: DepositStatus['code'],
    message: string,
    receipt?: ShieldedDepositResult,
  ): Readonly<DepositStatus> =>
    Object.freeze({
      requestId: original.requestId,
      state,
      code,
      message,
      ...(txId === undefined ? {} : { txId }),
      ...(receipt === undefined ? {} : { receipt: Object.freeze({ ...receipt }) }),
    });
  let status = makeStatus(
    'idle',
    'AwaitingReview',
    'Review the original deposit before unlocking its protected journal.',
  );
  const publish = (next: Readonly<DepositStatus>) => {
    status = next;
    // A display/logging failure cannot change the deposit outcome or trigger a replacement send.
    try {
      void Promise.resolve(observer?.(next)).catch(() => {});
    } catch {
      /* Observer diagnostics belong to the host. */
    }
    return next;
  };
  const remember = (value: unknown) => {
    if (validTx(value)) {
      if (txId !== undefined && txId !== value) throw new Error('Original transaction differs.');
      txId = value;
    }
  };
  const unresolved = () =>
    publish(
      makeStatus(
        'unresolved',
        'DepositUnsettled',
        'Outcome unresolved. Retain this request and original sender records; reconcile the same intent. Do not resend or allocate a replacement request ID.',
      ),
    );
  async function run(action: 'start' | 'reconcile'): Promise<Readonly<DepositStatus>> {
    if (busy)
      return makeStatus(
        'busy',
        'OperationInProgress',
        'Another review or operation is in progress for this original request.',
      );
    if (action === 'start' && started) return status.state === 'confirmed' ? status : unresolved();
    busy = true;
    try {
      const review = Object.freeze({ ...reviewBase, action, mayInvokeSender: action === 'start' });
      let approved: boolean;
      try {
        approved = (await approve(review)) === true;
      } catch {
        return publish(
          makeStatus(
            'declined',
            'ApprovalUnavailable',
            'Review unavailable. This attempt did not unlock the journal. Preserve any earlier deposit outcome.',
          ),
        );
      }
      if (!approved)
        return publish(
          makeStatus(
            'declined',
            'ApprovalDeclined',
            'Review declined. This attempt did not unlock the journal. Preserve any earlier deposit outcome.',
          ),
        );
      started = true;
      publish(
        makeStatus(
          'working',
          'OperationInProgress',
          action === 'start'
            ? 'Unlocking the original journal; the sender wallet has its own approval and assets.'
            : 'Checking the original request only. This action cannot invoke the sender.',
        ),
      );
      let originalEvidenceRequired = false;
      try {
        const receipt = await session(() => {
          const observedJournal = {
            read: async (id: string) => {
              const doc = await journal.read(id);
              // Reconciliation is intentionally narrower than SDK resume: prepared can dispatch.
              // Reject it on EVERY read, including a stale authenticated revision after contention.
              if (action === 'reconcile' && (!doc || doc.phase === 'prepared')) {
                originalEvidenceRequired = true;
                throw new Error('Retain original evidence; no dispatch from this action.');
              }
              if (doc) {
                if (
                  doc.intent.account !== original.account ||
                  doc.intent.amount !== original.amount.toString() ||
                  doc.intent.color !== hex(original.color) ||
                  doc.intent.nonce !== hex(original.nonce)
                )
                  throw new Error('Retained original intent differs.');
                remember(doc.txId);
              }
              return doc;
            },
            compareAndSwap: async (
              id: string,
              expected: number | undefined,
              next: ShieldedDepositDocument,
            ) => {
              if (
                action === 'reconcile' &&
                (next.phase === 'prepared' || next.phase === 'dispatching')
              )
                throw new Error('Reconciliation cannot admit a send.');
              return journal.compareAndSwap(id, expected, next);
            },
          };
          const ports: RecoverableShieldedDepositPorts = {
            ...timing,
            chain: { readAccount },
            sealCoin,
            sender: {
              depositShielded: async (request) => {
                if (action === 'reconcile') throw new Error('Reconciliation cannot send.');
                const reply = await send(request);
                remember(reply?.txId);
                return reply;
              },
            },
            recovery: {
              pins,
              journal: observedJournal,
              reconcileSender: async (intent, digest) => {
                const outcome = await lookup(intent, digest);
                if (outcome?.kind === 'submitted' && outcome.intentSha256 === digest)
                  remember(outcome.txId);
                return outcome;
              },
              confirmTransaction: confirm,
            },
          };
          const request = {
            ...original,
            color: original.color.slice(),
            nonce: original.nonce.slice(),
          };
          return action === 'start'
            ? depositShielded(request, ports)
            : resumeShieldedDeposit(request, ports);
        });
        remember(receipt.txId);
        return publish(
          makeStatus(
            'confirmed',
            'DepositConfirmed',
            'Original deposit confirmed. This retained receipt is historical, not a fresh balance or current viewing-key report.',
            receipt,
          ),
        );
      } catch {
        if (originalEvidenceRequired)
          return publish(
            makeStatus(
              'unresolved',
              'OriginalEvidenceRequired',
              'No dispatched original record is available to this action. Retain all original evidence; do not create a replacement request or infer no send.',
            ),
          );
        return unresolved();
      }
    } finally {
      busy = false;
    }
  }
  return Object.freeze({
    /** Local panel snapshot only: no journal read, network call, credential prompt or fresh finality. */
    status: () => status,
    start: () => run('start'),
    reconcile: () => run('reconcile'),
  });
}
