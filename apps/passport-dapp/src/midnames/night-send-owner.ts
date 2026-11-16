import type {
  PassportAccount,
  PreparedValueSubmission,
} from '@input-output-hk/mn-passport-protocol';
import { NIGHT_SEND_OPERATIONS, type NightSendIntent } from './night-send.js';

const NIGHT_COLOR = '00'.repeat(32);
const ADDRESS = /^[a-f0-9]{64}$/;

/** Bind the reviewed standalone NIGHT intent to one selected JubJub account API. */
export function createNightOwnerWithdrawal(account: PassportAccount) {
  const selected = {
    address: account.address,
    networkId: account.networkId,
    bindingId: account.bindingId,
    scheme: account.scheme,
  };
  const withdraw = account.withdrawUnshielded?.bind(account);
  return async (
    intent: NightSendIntent,
    beforeSubmit: (submission: PreparedValueSubmission) => Promise<void>,
  ): Promise<void> => {
    if (
      selected.networkId !== 'undeployed' ||
      selected.bindingId !== 'acc-s3r1.1' ||
      selected.scheme !== 'jubjub-schnorr' ||
      !ADDRESS.test(selected.address) ||
      account.address !== selected.address ||
      account.networkId !== selected.networkId ||
      account.bindingId !== selected.bindingId ||
      account.scheme !== selected.scheme ||
      !withdraw ||
      typeof beforeSubmit !== 'function'
    )
      throw new Error('The selected owner cannot fence this standalone NIGHT withdrawal.');
    if (
      intent.networkId !== selected.networkId ||
      intent.source !== selected.address ||
      intent.asset !== 'NIGHT' ||
      !ADDRESS.test(intent.bridge) ||
      !/^[1-9][0-9]{0,38}$/.test(intent.amount) ||
      BigInt(intent.amount) >= 1n << 128n ||
      intent.operations.length !== NIGHT_SEND_OPERATIONS.length ||
      intent.operations.some((operation, i) => operation !== NIGHT_SEND_OPERATIONS[i])
    )
      throw new Error('The reviewed NIGHT withdrawal differs from the selected owner.');
    await withdraw(
      { color: NIGHT_COLOR, amount: intent.amount, recipient: intent.bridge },
      { beforeSubmit },
    );
  };
}
