import type { MidnightProvider, WalletProvider } from '@midnight-ntwrk/midnight-js-types';
import { Transaction } from '@midnightntwrk/ledger-v9';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { FeeSponsor, Submitter } from '@input-output-hk/mn-passport-account/ports';

type WalletSeam = Pick<
  WalletProvider,
  'supportedEras' | 'getCoinPublicKey' | 'getEncryptionPublicKey' | 'balanceTx'
>;
type SubmitSeam = Pick<MidnightProvider, 'supportedEras' | 'submitTx'>;

/**
 * Adapt a host's value-capable midnight-js wallet and submitter to Passport's transaction ports.
 * The remote Passport sponsor deliberately refuses shielded offers. A host can use these ports for
 * `withdrawShielded` while retaining its fee-only sponsor for ordinary ACC calls.
 */
export function createMidnightWalletPorts(
  wallet: WalletSeam,
  submitter: SubmitSeam,
): {
  readonly sponsorKeys: { readonly coinPublicKey: string; readonly encryptionPublicKey: string };
  readonly sponsor: FeeSponsor;
  readonly submitter: Submitter;
} {
  if (!wallet.supportedEras.includes('v9') || !submitter.supportedEras.includes('v9'))
    throw new PassportConnectorError(
      'BindingUnsupported',
      'Shielded ACC calls require v9 wallet and submitter providers.',
    );
  const sponsorKeys = {
    coinPublicKey: wallet.getCoinPublicKey(),
    encryptionPublicKey: wallet.getEncryptionPublicKey(),
  };
  return {
    sponsorKeys,
    sponsor: {
      supportsShieldedOffers: true,
      async balanceAndSign(bytes) {
        const balanced = await wallet.balanceTx({
          version: 'v9',
          tx: Transaction.deserialize('signature', 'proof', 'pre-binding', bytes),
        });
        if (balanced.version !== 'v9')
          throw new PassportConnectorError(
            'BindingUnsupported',
            'The wallet balanced a shielded ACC call for an unexpected ledger era.',
          );
        return balanced.tx.serialize();
      },
    },
    submitter: {
      submit: (bytes) =>
        submitter.submitTx({
          version: 'v9',
          tx: Transaction.deserialize('signature', 'proof', 'binding', bytes),
        }),
    },
  };
}
