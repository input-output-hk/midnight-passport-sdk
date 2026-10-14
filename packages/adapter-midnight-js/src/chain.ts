import { CompiledContract, type Contract } from '@midnight-ntwrk/compact-js';
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import {
  createMidnightProvider,
  createProofProviderFromHandlers,
  createWalletProvider,
  type PublicDataProvider,
} from '@midnight-ntwrk/midnight-js-types';
import {
  PassportConnectorError,
  toPassportError,
} from '@input-output-hk/mn-passport-account/errors';
import type {
  AccLedgerView,
  AccPureCircuits,
  JubjubPureCircuits,
  Chain,
  FeeSponsor,
  NetworkConfig,
  Prover,
  Submitter,
} from '@input-output-hk/mn-passport-account/ports';
import type { PassportEvent, PassportStep } from '@input-output-hk/mn-passport-protocol';
import { Transaction } from '@midnightntwrk/ledger-v9';

interface LedgerShape {
  booted: boolean;
  auth_nonce: bigint;
  device_epoch: bigint;
  spec_version: bigint;
  enc_key: Uint8Array;
  devices: {
    member(entry: Uint8Array): boolean;
    size(): bigint;
    [Symbol.iterator](): Iterator<Uint8Array>;
  };
  inbox: {
    size(): bigint;
    [Symbol.iterator](): Iterator<[bigint, Uint8Array]>;
  };
}

/** The keyring caps openings at 4096; refuse an oversized ledger before collecting its entries. */
function inboxEntries(ledger: LedgerShape): Uint8Array[] {
  if (ledger.inbox.size() > 4096n) throw new Error('ACC inbox exceeds the supported 4096 entries');
  return [...ledger.inbox]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, entry]) => entry);
}

/** Lace's owner flow names at most 64 live entries when it rotates a viewing secret. */
function deviceEntries(ledger: LedgerShape): Uint8Array[] {
  if (ledger.devices.size() > 64n) throw new Error('ACC has more than 64 live device entries');
  const entries = [...ledger.devices];
  if (entries.length !== Number(ledger.devices.size()))
    throw new Error('ACC live device count does not match its set');
  return entries.map((entry) => {
    if (entry.length !== 32) throw new Error('ACC has a malformed device commitment');
    return entry.slice();
  });
}

/** The generated binding is loaded by the host, normally with import(). */
export interface MidnightBinding {
  readonly Contract: new (witnesses: never) => Contract.Any;
  ledger(data: unknown): unknown;
  readonly pureCircuits: AccPureCircuits & Partial<JubjubPureCircuits>;
}

/** Injects the heavy Midnight call pipeline behind the account core's Chain port. */
export function createMidnightChain(opts: {
  network: NetworkConfig;
  binding: MidnightBinding;
  prover: Prover;
  sponsor: FeeSponsor;
  /** Public fee-payer keys needed by midnight-js while assembling the call. */
  sponsorKeys: { readonly coinPublicKey: string; readonly encryptionPublicKey: string };
  submitter: Submitter;
  /** An indexer substitute for local tests. */
  publicDataProvider?: PublicDataProvider;
  /** A call substitute for local tests. */
  submit?: typeof submitCallTx;
}): Chain {
  const { network, binding, prover, sponsor, submitter } = opts;
  if (!/^[0-9a-f]{64}$/i.test(network.manifestSha256)) {
    throw new PassportConnectorError(
      'ArtefactIntegrity',
      'The binding manifest pin must be SHA-256.',
    );
  }
  const compiledContract = CompiledContract.make('account', binding.Contract as never).pipe(
    CompiledContract.withWitnesses({
      held_coin: () => {
        throw new Error('held_coin is not available in the Passport binding');
      },
    } as never),
  );
  const publicDataProvider =
    opts.publicDataProvider ??
    indexerPublicDataProvider({
      queryURL: network.indexerUrl,
      subscriptionURL: network.indexerWsUrl,
    });
  const zkConfigProvider = new FetchZkConfigProvider<string>(network.artefactUrl, {
    verify: 'require',
    expectedManifestHash: network.manifestSha256.toLowerCase(),
  });

  return {
    async readAccount(address, options): Promise<AccLedgerView | undefined> {
      setNetworkId(network.networkId);
      const state = await publicDataProvider.queryContractState(address);
      if (!state) return undefined;
      const ledger = binding.ledger(state.data) as LedgerShape;
      return {
        booted: ledger.booted,
        authNonce: ledger.auth_nonce,
        deviceEpoch: ledger.device_epoch,
        entryCount: Number(ledger.devices.size()),
        specVersion: Number(ledger.spec_version),
        encKey: ledger.enc_key,
        ...(options?.includeInbox && { inboxEntries: inboxEntries(ledger) }),
        ...(options?.includeDevices && { deviceEntries: deviceEntries(ledger) }),
        hasEntry: (entry) => ledger.devices.member(entry),
      };
    },
    async call({ address, circuit, args, onEvent, ...flowOptions }) {
      setNetworkId(network.networkId);
      // Progress listeners are observers: a host's UI error must not interrupt a chain call.
      const emit = (event: PassportEvent) => {
        try {
          onEvent?.(event);
        } catch {
          // The account operation remains authoritative.
        }
      };
      const report = (step: PassportStep) => {
        const base = { id: crypto.randomUUID(), flowId: '', step, clock: 'client' as const };
        const at = Date.now();
        emit({ ...base, phase: 'start', at });
        return (error?: unknown) => {
          const end = Date.now();
          const failed = error === undefined ? undefined : toPassportError(error, step);
          const event: PassportEvent = {
            ...base,
            phase: failed ? 'error' : 'end',
            at: end,
            durationMs: end - at,
            ...(failed && { error: { code: failed.code, message: failed.message } }),
          };
          emit(event);
        };
      };
      const track = async <T>(step: PassportStep, work: () => Promise<T>): Promise<T> => {
        const finish = report(step);
        try {
          const value = await work();
          finish();
          return value;
        } catch (error) {
          finish(error ?? 'failed');
          throw error;
        }
      };
      let finality: ReturnType<typeof report> | undefined;
      const providers = {
        publicDataProvider,
        zkConfigProvider,
        proofProvider: createProofProviderFromHandlers({
          currentEra: (tx) =>
            track('prove', async () => {
              const result = await prover.proveTx(tx.serialize(), {
                ...flowOptions,
                networkId: network.networkId,
                bindingId: network.bindingId,
                circuits: [circuit],
              });
              return Transaction.deserialize('signature', 'proof', 'pre-binding', result.tx);
            }),
        }),
        walletProvider: createWalletProvider({
          getCoinPublicKey: () => opts.sponsorKeys.coinPublicKey,
          getEncryptionPublicKey: () => opts.sponsorKeys.encryptionPublicKey,
          balanceTx: (tx) =>
            track('sponsor.balance', async () =>
              Transaction.deserialize(
                'signature',
                'proof',
                'binding',
                await sponsor.balanceAndSign(tx.serialize()),
              ),
            ),
        }),
        midnightProvider: createMidnightProvider(async (tx) => {
          const id = await track('sponsor.submit', () => submitter.submit(tx.serialize()));
          finality = report('chain.finality');
          return id;
        }),
      };
      let result;
      try {
        result = await (opts.submit ?? submitCallTx)(providers, {
          compiledContract,
          contractAddress: address,
          circuitId: circuit,
          args,
        } as never);
      } catch (error) {
        finality?.(error ?? 'failed');
        throw error;
      }
      finality?.();
      return { txHash: result.public.txHash, blockHeight: result.public.blockHeight };
    },
  };
}
