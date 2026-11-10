/** Resolve optional account methods at their original use point and retain receivers. */
import type {
  PassportAccount,
  PassportConnectorAPI,
  FlowOptions,
} from '@input-output-hk/mn-passport-protocol';

export function readGrantRoster(account: PassportAccount) {
  const method = account.grantRoster;
  if (!method) throw new Error('This Passport account has no grant roster source.');
  return method.call(account);
}
export function readDeviceRoster(account: PassportAccount) {
  const method = account.deviceRoster;
  if (!method) throw new Error('This Passport account has no device roster source.');
  return method.call(account);
}
export function openAccountAt(api: PassportConnectorAPI, address: string, options: FlowOptions) {
  const method = api.openAccountAt;
  if (!method) throw new Error('This Passport connector cannot open by address.');
  return method.call(api, address, options);
}
