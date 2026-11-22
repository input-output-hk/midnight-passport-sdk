import type {
  PassportAccount,
  PreparedValueSubmission,
} from '@input-output-hk/mn-passport-protocol';
import { NIGHT_SEND_OPERATIONS, type NightSendIntent } from './night-send.js';
import { localNightBinding } from './local-binding.js';

const NIGHT_COLOR = '00'.repeat(32);
const ADDRESS = /^[a-f0-9]{64}$/;

/** Bind the reviewed standalone NIGHT intent to one selected JubJub account API. */
export function createNightOwnerWithdrawal(
  account: PassportAccount,
  checkApproved?: (intent: NightSendIntent) => void,
) {
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
    if (!Array.isArray(intent.operations))
      throw new Error('The reviewed NIGHT withdrawal differs from the selected owner.');
    const reviewed: NightSendIntent = Object.freeze({
      requestId: intent.requestId,
      name: intent.name,
      networkId: intent.networkId,
      source: intent.source,
      bridge: intent.bridge,
      asset: intent.asset,
      amount: intent.amount,
      target: intent.target,
      providerId: intent.providerId,
      namespace: intent.namespace,
      operations: Object.freeze([...intent.operations]) as typeof NIGHT_SEND_OPERATIONS,
    });
    if (
      selected.networkId !== 'undeployed' ||
      !localNightBinding(selected.bindingId) ||
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
      reviewed.networkId !== selected.networkId ||
      reviewed.source !== selected.address ||
      reviewed.asset !== 'NIGHT' ||
      !ADDRESS.test(reviewed.bridge) ||
      !/^[1-9][0-9]{0,38}$/.test(reviewed.amount) ||
      BigInt(reviewed.amount) >= 1n << 128n ||
      reviewed.operations.length !== NIGHT_SEND_OPERATIONS.length ||
      reviewed.operations.some((operation, i) => operation !== NIGHT_SEND_OPERATIONS[i])
    )
      throw new Error('The reviewed NIGHT withdrawal differs from the selected owner.');
    await withdraw(
      { color: NIGHT_COLOR, amount: reviewed.amount, recipient: reviewed.bridge },
      {
        beforeSubmit: checkApproved
          ? async (submission) => {
              checkApproved(reviewed);
              await beforeSubmit(submission);
            }
          : beforeSubmit,
      },
    );
  };
}
