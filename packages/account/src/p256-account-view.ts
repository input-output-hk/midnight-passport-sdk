import { P256Withdrawals } from './p256-withdrawals.js';
import { P256PrivateAccess } from './p256-private-access.js';
import { P256GrantMethods } from './p256-grant-methods.js';
import type { P256AccountContext } from './p256-account-context.js';
import type { P256Hint } from './p256-device.js';
import type { PassportAccount, DeviceRemovalResult } from '@input-output-hk/mn-passport-protocol';
import { toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { revokeP256Grant, revokeAllP256Grants } from './p256-grant-revocation.js';
/** Public facade over private P-256 operation groups; no host or key material is spread. */
export function p256AccountView(
  accountHost: P256AccountContext,
  revocation: Parameters<typeof revokeP256Grant>[0],
  record: P256Hint,
): PassportAccount {
  const {
    networkId,
    network,
    addP256Device,
    readAccount,
    chain,
    ports,
    rotateP256ViewingKey,
    run,
  } = accountHost;

  const withdrawals = new P256Withdrawals(accountHost, record),
    privateAccess = new P256PrivateAccess(accountHost, record),
    grants = new P256GrantMethods(accountHost, record);
  return {
    address: record.address,
    networkId,
    bindingId: network.bindingId,
    scheme: record.scheme,
    credentialId: Uint8Array.from(record.credentialId),
    withdrawUnshielded: withdrawals.withdrawUnshielded,
    withdrawShielded: withdrawals.withdrawShielded,
    ...(ports.partialShieldedWithdrawal && {
      withdrawShieldedPartial: withdrawals.withdrawShieldedPartial,
    }),
    addDevice: (reader, options) => {
      return addP256Device(record, reader, options);
    },
    async state() {
      const view = await readAccount(record);
      return {
        booted: view.booted,
        authNonce: view.authNonce,
        deviceEpoch: view.deviceEpoch,
        entryCount: view.entryCount,
        specVersion: view.specVersion,
      };
    },
    async deviceRoster() {
      const view = await (await chain()).readAccount(record.address, { includeDevices: true });
      if (!view?.booted || !view.deviceEntries || view.deviceEntries.length !== view.entryCount)
        throw new PassportConnectorError(
          'DeviceRosterInvalid',
          'The live ACC roster is unavailable.',
        );
      return {
        deviceEpoch: view.deviceEpoch,
        authNonce: view.authNonce,
        commitments: view.deviceEntries.map(toHex).sort(),
      };
    },
    async grantRoster() {
      if (!ports.grantRoster)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'A live ACC grant roster is required.',
        );
      return ports.grantRoster.readGrantRoster(record.address);
    },
    readShieldedHoldings: privateAccess.readShieldedHoldings,
    rotateViewingKey: (options) => rotateP256ViewingKey(record, options),
    removeDevice: (commitmentHex, options) =>
      rotateP256ViewingKey(record, options, commitmentHex) as Promise<DeviceRemovalResult>,
    rotateEncryptionKey: privateAccess.rotateEncryptionKey,
    issueGrant: grants.issueGrant,
    recoverPendingGrants: grants.recoverPendingGrants,
    revokeGrant: (grantId, options = {}) =>
      run(options, (flow) => revokeP256Grant(revocation, record, grantId, options, flow)),
    revokeAllGrants: (options = {}) =>
      run(options, (flow) => revokeAllP256Grants(revocation, record, options, flow)),
  };
}
