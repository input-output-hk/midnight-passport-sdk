import { Transaction, addressFromKey } from '@midnightntwrk/ledger-v9';
import type { WalletFacade } from '@midnightntwrk/wallet-sdk-facade';
import {
  checkedNightBridgeOutput,
  hasExactNightBridgeCoin,
  type NightBridgeOutput,
  type NightBridgeTransaction,
} from '../midnames/night-bridge-output.js';
import { assertExactNightDeposit } from '../midnames/night-deposit-check.js';
import type { NightSendLeg } from '../midnames/night-send.js';
import type { BrowserNightSendScope } from '../midnames/night-send-journal.js';
import { validNightCredentialHex } from '../midnames/night-send-credential.js';

const HEX = /^[a-f0-9]{64}$/;
const ID = /^[a-f0-9]{66}$/;
const MAX_PROVEN_BYTES = 4 * 1024 * 1024;

export interface DeviceNightDepositRequest {
  readonly scope: BrowserNightSendScope;
  readonly target: string;
  readonly output: NightBridgeOutput;
  /** Proven, pre-binding ACC `deposit_unshielded` call; never a signer or seed. */
  readonly proven: Uint8Array;
}

/** The worker does not trust a page-to-worker TypeScript cast or a mutated buffer. */
export function checkedDeviceNightDepositRequest(value: unknown): DeviceNightDepositRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid NIGHT deposit request.');
  const row = value as Record<string, unknown>;
  const scope = row.scope as Record<string, unknown> | undefined;
  if (
    !scope ||
    scope.networkId !== 'undeployed' ||
    typeof scope.source !== 'string' ||
    !HEX.test(scope.source) ||
    !validNightCredentialHex(scope.credentialId) ||
    typeof row.target !== 'string' ||
    !HEX.test(row.target) ||
    !(row.proven instanceof Uint8Array) ||
    row.proven.length === 0 ||
    row.proven.length > MAX_PROVEN_BYTES
  )
    throw new Error('Invalid NIGHT deposit request.');
  return {
    scope: {
      networkId: 'undeployed',
      source: scope.source,
      credentialId: scope.credentialId,
    },
    target: row.target,
    output: checkedNightBridgeOutput(row.output),
    proven: Uint8Array.from(row.proven),
  };
}

export function checkedDeviceNightLeg(value: unknown): NightSendLeg {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid device-held NIGHT transaction identity.');
  const row = value as Record<string, unknown>;
  const { hash, identifiers } = row;
  if (
    typeof hash !== 'string' ||
    !HEX.test(hash) ||
    !Array.isArray(identifiers) ||
    identifiers.length === 0 ||
    identifiers.length > 32 ||
    identifiers.some((id) => typeof id !== 'string' || !ID.test(id)) ||
    new Set(identifiers).size !== identifiers.length
  )
    throw new Error('The device-held deposit has no usable original transaction ID.');
  return { hash, identifiers: [...identifiers] as string[] };
}

type DepositFacade = Pick<
  WalletFacade,
  | 'adoptTransaction'
  | 'balanceUnboundTransaction'
  | 'signRecipe'
  | 'finalizeRecipe'
  | 'submitTransaction'
  | 'revert'
>;

/** One in-memory prepared original per wallet session; a lost dispatch answer cannot be replayed. */
export function deviceNightDeposit(
  facade: DepositFacade,
  sign: Parameters<DepositFacade['signRecipe']>[1],
  available: () => Promise<Parameters<typeof hasExactNightBridgeCoin>[0]>,
  bridge: string,
  networkId: string,
  enabled: boolean,
  verifyOutput: (
    scope: BrowserNightSendScope,
    target: string,
    output: NightBridgeOutput,
  ) => Promise<NightBridgeOutput>,
  fenced: (
    scope: BrowserNightSendScope,
    original: NightSendLeg,
    output: NightBridgeOutput,
    target: string,
  ) => Promise<boolean>,
  decode: (raw: Uint8Array) => NightBridgeTransaction = (raw) =>
    Transaction.deserialize('signature', 'proof', 'binding', raw) as NightBridgeTransaction,
  address: (owner: unknown) => string = (owner) =>
    addressFromKey(owner as Parameters<typeof addressFromKey>[0]),
  encodedBridge?: string,
) {
  let preparing = false;
  let prepared:
    | {
        readonly finalized: Awaited<ReturnType<DepositFacade['finalizeRecipe']>>;
        readonly original: NightSendLeg;
        readonly request: DeviceNightDepositRequest;
        attempted: boolean;
      }
    | undefined;
  return {
    async prepare(value: DeviceNightDepositRequest): Promise<NightSendLeg> {
      if (preparing || prepared) throw new Error('Reconcile the previous NIGHT deposit original.');
      preparing = true;
      let reservation: Parameters<DepositFacade['revert']>[0] | undefined;
      try {
        const request = checkedDeviceNightDepositRequest(value);
        if (
          networkId !== 'undeployed' ||
          !enabled ||
          !HEX.test(bridge) ||
          request.output.owner !== bridge
        )
          throw new Error('The original controlled NIGHT output is unavailable to this wallet.');
        const verified = checkedNightBridgeOutput(
          await verifyOutput(request.scope, request.target, request.output),
        );
        if (
          verified.owner !== bridge ||
          !(await hasExactNightBridgeCoin(await available(), verified, encodedBridge))
        )
          throw new Error('The original controlled NIGHT output is unavailable to this wallet.');
        const adopted = facade.adoptTransaction(request.proven, 'Unbound');
        const recipe = await facade.balanceUnboundTransaction(adopted, {
          ttl: new Date(Date.now() + 15 * 60_000),
          tokenKindsToBalance: ['unshielded', 'dust'],
        });
        reservation = recipe;
        const signed = await facade.signRecipe(recipe, sign);
        reservation = signed;
        const finalized = await facade.finalizeRecipe(signed);
        reservation = finalized;
        // The facade's local validation snapshot omits the already deployed ACC.
        // Check the exact call, value and bridge output below; node admission
        // validates the finalized transaction against the live contract state.
        const transaction = decode(finalized.serialize());
        assertExactNightDeposit(transaction, verified, request.target, address);
        const original = checkedDeviceNightLeg({
          hash: transaction.transactionHash(),
          identifiers: transaction.identifiers(),
        });
        prepared = {
          finalized,
          original,
          request: { ...request, output: verified },
          attempted: false,
        };
        return { hash: original.hash, identifiers: [...original.identifiers] };
      } catch (error) {
        if (reservation) await facade.revert(reservation).catch(() => undefined);
        throw error;
      } finally {
        preparing = false;
      }
    },
    async submit(original: NightSendLeg): Promise<string> {
      const checked = checkedDeviceNightLeg(original);
      const pending = prepared;
      if (
        !pending ||
        pending.attempted ||
        checked.hash !== pending.original.hash ||
        JSON.stringify(checked.identifiers) !== JSON.stringify(pending.original.identifiers)
      )
        throw new Error('Only the fenced original NIGHT deposit can be dispatched once.');
      // Reserve before the asynchronous IndexedDB read: concurrent worker RPCs must not both dispatch.
      pending.attempted = true;
      let durable: boolean;
      try {
        durable = await fenced(
          pending.request.scope,
          pending.original,
          pending.request.output,
          pending.request.target,
        );
      } catch (error) {
        pending.attempted = false;
        throw error;
      }
      if (!durable) {
        pending.attempted = false;
        throw new Error('The original NIGHT deposit has no matching durable journal fence.');
      }
      const result = await facade.submitTransaction(pending.finalized);
      if (result !== pending.original.identifiers.at(-1))
        throw new Error('The device wallet returned a different NIGHT submission ID.');
      return result;
    },
  };
}
