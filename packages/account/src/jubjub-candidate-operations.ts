import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import type { NetworkConfig } from './ports/index.js';
import { PassportConnectorError } from './errors.js';

/** Keep unqualified candidate methods behind the account API boundary. */
export function limitProvisionalJubjubAccount(
  network: Pick<NetworkConfig, 'bindingId'>,
  account: PassportAccount,
): PassportAccount {
  if (network.bindingId !== 'acc-s3r1.1-zkir036') return account;
  const unsupported = (): never => {
    throw new PassportConnectorError(
      'BindingUnsupported',
      'This provisional Ledger 9 binding has no qualified device, rotation, or shielded-holdings flow.',
    );
  };
  return {
    ...account,
    rotateViewingKey: async () => unsupported(),
    removeDevice: async () => unsupported(),
    addDevice: async () => unsupported(),
    readShieldedHoldings: async () => unsupported(),
  };
}
