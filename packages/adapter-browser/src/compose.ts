import { createPassportAccounts } from '@input-output-hk/mn-passport-account';
import type {
  AccountDirectory,
  AccountRecordStore,
  Deployer,
  FeeSponsor,
  Lazy,
  NetworkConfig,
  Prover,
  Submitter,
} from '@input-output-hk/mn-passport-account/ports';
import { webauthnPasskey } from '@input-output-hk/mn-passport-adapter-webauthn';
import { recipeEncryptionKey } from '@input-output-hk/mn-passport-keys';
import type { PassportConnectorAPI } from '@input-output-hk/mn-passport-protocol';
import type { MidnightBinding } from '@input-output-hk/mn-passport-adapter-midnight-js';

/** A browser host supplies policy and network ports; this package supplies the browser key source. */
export interface BrowserPassportConfig {
  readonly network: NetworkConfig;
  readonly binding: Lazy<MidnightBinding>;
  readonly passkey: {
    readonly rpId: string;
    readonly origin: string;
    readonly credentials?: CredentialsContainer;
  };
  readonly prover: Prover;
  readonly sponsor: FeeSponsor;
  readonly sponsorKeys: { readonly coinPublicKey: string; readonly encryptionPublicKey: string };
  readonly submitter: Submitter;
  readonly deployer: Deployer;
  readonly directory: AccountDirectory;
  readonly records?: AccountRecordStore;
  readonly random?: (length: number) => Uint8Array;
}

/** Assemble a Passport account API without loading midnight-js until the first chain operation. */
export function createBrowserPassport(config: BrowserPassportConfig): PassportConnectorAPI {
  const passkey = webauthnPasskey(config.passkey);
  const binding = async (): Promise<MidnightBinding> =>
    typeof config.binding === 'function' ? config.binding() : config.binding;
  return createPassportAccounts({
    network: config.network,
    binding,
    credentials: passkey.credentials,
    authoriser: passkey.p256,
    encryptionKey: recipeEncryptionKey(passkey.prf),
    chain: async () => {
      const [{ createMidnightChain }, module] = await Promise.all([
        import('@input-output-hk/mn-passport-adapter-midnight-js'),
        binding(),
      ]);
      return createMidnightChain({
        network: config.network,
        binding: module,
        prover: config.prover,
        sponsor: config.sponsor,
        sponsorKeys: config.sponsorKeys,
        submitter: config.submitter,
      });
    },
    deployer: config.deployer,
    directory: config.directory,
    ...(config.records && { records: config.records }),
    ...(config.random && { random: config.random }),
  });
}
