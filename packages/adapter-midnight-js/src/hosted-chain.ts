import type { Chain, NetworkConfig } from '@input-output-hk/mn-passport-account/ports';
import type { FlowOptions } from '@input-output-hk/mn-passport-protocol';

/** The pinned ACC ledger shape returned by a hosted Midnight decoder. */
export interface HostedAccLedger {
  readonly booted: boolean;
  readonly auth_nonce: bigint;
  readonly device_epoch: bigint;
  readonly spec_version: bigint;
  readonly enc_key: Uint8Array;
  readonly devices: {
    member(entry: Uint8Array): boolean;
    size(): bigint;
    [Symbol.iterator](): Iterator<Uint8Array>;
  };
  readonly inbox: {
    size(): bigint;
    [Symbol.iterator](): Iterator<[bigint, Uint8Array]>;
  };
}

/** A host handle that proves, balances, submits, and waits for one ACC call. */
export interface HostedAccHandle {
  readonly callTx: Readonly<Record<string, ((...args: unknown[]) => Promise<unknown>) | undefined>>;
}

export interface HostedAccChainOptions {
  readonly network: Pick<NetworkConfig, 'bindingId' | 'manifestSha256'>;
  /** From the host's pinned contract registry, for example `resolveBinding(bindingId)`. */
  readonly binding: {
    readonly id: string;
    readonly manifestSha256: string;
    readonly circuits: Readonly<Record<string, { readonly proof: boolean }>>;
  };
  /** Decode the live ACC on the pinned network; answer undefined when it is absent. */
  readonly readLedger: (address: string) => Promise<HostedAccLedger | undefined>;
  /** Connect the host's own transaction providers, including its prover and funded fee wallet. */
  readonly connectHandle: (address: string, options: FlowOptions) => Promise<HostedAccHandle>;
}

/**
 * Adapt a hosted transaction pipeline, such as Lace's `GatedContractHandle`, to the account port.
 * The host owns proof and submission; this bridge pins circuit names, maps the live ledger, and
 * rejects a finalized failure before an account owner flow advances its local counter.
 */
export function createHostedAccChain(options: HostedAccChainOptions): Chain {
  const { binding } = options;
  if (
    binding.id !== options.network.bindingId ||
    !/^[0-9a-f]{64}$/i.test(options.network.manifestSha256) ||
    binding.manifestSha256.toLowerCase() !== options.network.manifestSha256.toLowerCase()
  )
    throw new Error('hosted ACC chain manifest differs from the pinned binding');

  return {
    async readAccount(address, request) {
      const ledger = await options.readLedger(address);
      if (!ledger) return undefined;
      const inboxEntries = request?.includeInbox
        ? (() => {
            if (ledger.inbox.size() > 4096n) throw new Error('ACC inbox exceeds 4096 entries');
            return [...ledger.inbox]
              .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
              .map(([, entry]) => entry.slice());
          })()
        : undefined;
      const deviceEntries = request?.includeDevices
        ? (() => {
            if (ledger.devices.size() > 64n) throw new Error('ACC has more than 64 devices');
            const entries = [...ledger.devices];
            if (entries.length !== Number(ledger.devices.size()))
              throw new Error('ACC device set size differs from its entries');
            return entries.map((entry) => {
              if (entry.length !== 32) throw new Error('ACC has a malformed device commitment');
              return entry.slice();
            });
          })()
        : undefined;
      return {
        booted: ledger.booted,
        authNonce: ledger.auth_nonce,
        deviceEpoch: ledger.device_epoch,
        entryCount: Number(ledger.devices.size()),
        specVersion: Number(ledger.spec_version),
        encKey: ledger.enc_key.slice(),
        ...(inboxEntries && { inboxEntries }),
        ...(deviceEntries && { deviceEntries }),
        hasEntry: (entry: Uint8Array) => ledger.devices.member(entry),
      };
    },
    async call({ address, circuit, args, signal, onEvent }) {
      const pin = binding.circuits[circuit];
      if (!pin?.proof) throw new Error(`ACC circuit ${circuit} is absent from the pinned binding`);
      if (signal?.aborted) throw new Error('ACC call was aborted before submission');
      const handle = await options.connectHandle(address, {
        ...(signal && { signal }),
        ...(onEvent && { onEvent }),
      });
      if (signal?.aborted) throw new Error('ACC call was aborted before submission');
      const call = handle.callTx[circuit];
      if (!call) throw new Error(`hosted ACC handle has no circuit ${circuit}`);
      const finalized = (await call(...args)) as {
        readonly status?: unknown;
        readonly public?: {
          readonly status?: unknown;
          readonly txId?: string;
          readonly txHash?: string;
          readonly blockHeight?: number;
        };
      };
      const status = finalized?.public?.status ?? finalized?.status;
      if (String(status).toLowerCase().includes('fail'))
        throw new Error(`hosted ACC call ${circuit} failed: ${String(status)}`);
      const txHash = finalized?.public?.txHash ?? finalized?.public?.txId;
      if (!txHash) throw new Error(`hosted ACC call ${circuit} returned no transaction ID`);
      return {
        txHash,
        ...(finalized.public?.blockHeight === undefined
          ? {}
          : { blockHeight: finalized.public.blockHeight }),
      };
    },
  };
}
