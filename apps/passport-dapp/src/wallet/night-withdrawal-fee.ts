import type { NightBridgeTransaction } from '../midnames/night-bridge-output.js';
import { Transaction } from '@midnightntwrk/ledger-v9';
import type { WalletFacade } from '@midnightntwrk/wallet-sdk-facade';
import { validNightCredentialHex } from '../midnames/night-send-credential.js';
import type { BrowserNightSendScope } from '../midnames/night-send-journal.js';

const ADDRESS = /^[a-f0-9]{64}$/;
const NIGHT = '00'.repeat(32);
const MAX_TX_BYTES = 4 * 1024 * 1024;

export interface DeviceNightWithdrawalFeeRequest {
  readonly scope: BrowserNightSendScope;
  readonly bridge: string;
  readonly amount: string;
  readonly proven: Uint8Array;
}

/** Parse the page-to-worker request before the wallet touches a transaction. */
export function checkedNightWithdrawalFeeRequest(value: unknown): DeviceNightWithdrawalFeeRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid NIGHT withdrawal fee request.');
  const row = value as Record<string, unknown>;
  const scope = row.scope as Record<string, unknown> | undefined;
  if (
    !scope ||
    scope.networkId !== 'undeployed' ||
    typeof scope.source !== 'string' ||
    !ADDRESS.test(scope.source) ||
    !validNightCredentialHex(scope.credentialId) ||
    typeof row.bridge !== 'string' ||
    !ADDRESS.test(row.bridge) ||
    typeof row.amount !== 'string' ||
    !/^[1-9][0-9]{0,38}$/.test(row.amount) ||
    BigInt(row.amount) >= 1n << 128n ||
    !(row.proven instanceof Uint8Array) ||
    row.proven.length === 0 ||
    row.proven.length > MAX_TX_BYTES
  )
    throw new Error('Invalid NIGHT withdrawal fee request.');
  return {
    scope: { networkId: 'undeployed', source: scope.source, credentialId: scope.credentialId },
    bridge: row.bridge,
    amount: row.amount,
    proven: Uint8Array.from(row.proven),
  };
}

/** Refuse to sign fees for a different call, output, or wallet NIGHT input. */
export function assertExactNightWithdrawalFee(
  transaction: NightBridgeTransaction,
  request: Pick<DeviceNightWithdrawalFeeRequest, 'scope' | 'bridge' | 'amount'>,
): void {
  const actions = [...(transaction.intents?.values() ?? [])].flatMap(
    (intent) => intent.actions ?? [],
  );
  const outputs = [...(transaction.intents?.values() ?? [])].flatMap((intent) =>
    [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer]
      .filter((offer) => offer !== undefined)
      .flatMap((offer) => offer.outputs),
  );
  const inputs = [...(transaction.intents?.values() ?? [])].flatMap((intent) =>
    [intent.guaranteedUnshieldedOffer, intent.fallibleUnshieldedOffer]
      .filter((offer) => offer !== undefined)
      .flatMap((offer) => offer.inputs),
  );
  const [action] = actions as { readonly address?: unknown; readonly entryPoint?: unknown }[];
  const [output] = outputs;
  if (
    transaction.rewards !== undefined ||
    transaction.guaranteedOffer !== undefined ||
    (transaction.fallibleOffer?.size ?? 0) !== 0 ||
    actions.length !== 1 ||
    action?.address !== request.scope.source ||
    action.entryPoint !== 'withdraw_unshielded_with_jubjub' ||
    inputs.length !== 0 ||
    outputs.length !== 1 ||
    output?.owner !== request.bridge ||
    output.type !== NIGHT ||
    output.value !== BigInt(request.amount)
  )
    throw new Error('The wallet refuses fees for a different NIGHT withdrawal.');
}

type FeeFacade = Pick<
  WalletFacade,
  'adoptTransaction' | 'balanceUnboundTransaction' | 'signRecipe' | 'finalizeRecipe' | 'revert'
>;

/** The device wallet pays Dust only; it never dispatches this owner withdrawal. */
export function deviceNightWithdrawalFee(
  facade: FeeFacade,
  sign: Parameters<FeeFacade['signRecipe']>[1],
  bridge: string,
  networkId: string,
  ready: () => Promise<void>,
  decode: (bytes: Uint8Array, binding: 'pre-binding' | 'binding') => NightBridgeTransaction = (
    bytes,
    binding,
  ) => Transaction.deserialize('signature', 'proof', binding, bytes) as NightBridgeTransaction,
) {
  let balancing = false;
  return async (value: DeviceNightWithdrawalFeeRequest): Promise<Uint8Array> => {
    if (balancing) throw new Error('The device wallet is already balancing a NIGHT withdrawal.');
    balancing = true;
    let reservation: Parameters<FeeFacade['revert']>[0] | undefined;
    try {
      const request = checkedNightWithdrawalFeeRequest(value);
      if (networkId !== 'undeployed' || request.bridge !== bridge)
        throw new Error('The NIGHT fee wallet differs from the reviewed bridge.');
      assertExactNightWithdrawalFee(decode(request.proven, 'pre-binding'), request);
      await ready();
      const adopted = facade.adoptTransaction(request.proven, 'Unbound');
      // The proved value output is intentionally unbalanced at this stage.
      // The wallet contributes only Dust fees.
      const recipe = await facade.balanceUnboundTransaction(adopted, {
        ttl: new Date(Date.now() + 60_000),
        tokenKindsToBalance: ['dust'],
      });
      reservation = recipe;
      const signed = await facade.signRecipe(recipe, sign);
      reservation = signed;
      const finalized = await facade.finalizeRecipe(signed);
      reservation = finalized;
      const bytes = finalized.serialize();
      // This wallet SDK's local validation snapshot omits ACC contract state. The
      // exact finalized action/output guard runs here; node admission and the
      // journaled finalized-chain check still decide transaction success.
      assertExactNightWithdrawalFee(decode(bytes, 'binding'), request);
      return Uint8Array.from(bytes);
    } catch (error) {
      if (reservation) await facade.revert(reservation).catch(() => undefined);
      throw error;
    } finally {
      balancing = false;
    }
  };
}
