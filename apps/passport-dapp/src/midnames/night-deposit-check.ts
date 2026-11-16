import { ContractCall } from '@midnightntwrk/ledger-v9';
import {
  assertExactNightBridgeSpend,
  type NightBridgeOutput,
  type NightBridgeTransaction,
} from './night-bridge-output.js';

const HEX = /^[a-f0-9]{64}$/;

/** The device-held signer accepts one exact ACC deposit call and no other NIGHT destination. */
export function assertExactNightDeposit(
  transaction: NightBridgeTransaction,
  expected: NightBridgeOutput,
  target: string,
  addressFromKey: (owner: unknown) => string,
): void {
  if (
    !HEX.test(target) ||
    transaction.rewards ||
    transaction.guaranteedOffer ||
    transaction.fallibleOffer?.size
  )
    throw new Error('The prepared NIGHT deposit contains an unsupported top-level action.');
  const actions = [...(transaction.intents ?? [])].flatMap(([, intent]) => intent.actions ?? []);
  const [call] = actions;
  const entry =
    call instanceof ContractCall
      ? typeof call.entryPoint === 'string'
        ? call.entryPoint
        : new TextDecoder().decode(call.entryPoint)
      : undefined;
  if (
    actions.length !== 1 ||
    !(call instanceof ContractCall) ||
    call.address !== target ||
    entry !== 'deposit_unshielded' ||
    [...(transaction.intents ?? [])].some(
      ([, intent]) =>
        (intent.guaranteedUnshieldedOffer?.outputs.length ?? 0) !== 0 ||
        (intent.fallibleUnshieldedOffer?.outputs.length ?? 0) !== 0,
    )
  )
    throw new Error('The prepared NIGHT deposit differs from the reviewed ACC call.');
  assertExactNightBridgeSpend(transaction, expected, addressFromKey);
}
