import { createPassportAccounts } from '@input-output-hk/mn-passport-account';
import type {
  AccountDirectory,
  AccountRecordStore,
  ActiveGrantSnapshotSource,
  GrantCommitmentSource,
  GrantDetailSource,
  GrantRosterSource,
  ActiveReadGrantTargetSource,
  Authoriser,
  Deployer,
  FeeSponsor,
  Lazy,
  JubjubPureCircuits,
  NetworkConfig,
  Prover,
  Submitter,
  VerifiedHoldingSource,
} from '@input-output-hk/mn-passport-account/ports';
import type { GrantPublicationJournal } from '@input-output-hk/mn-passport-account';
import { webauthnPasskey } from '@input-output-hk/mn-passport-adapter-webauthn';
import {
  recipeDeviceKeyring,
  recipeEncryptionKey,
  recipeJubjubAuthoriser,
} from '@input-output-hk/mn-passport-keys';
import type { PassportConnectorAPI } from '@input-output-hk/mn-passport-protocol';
import type { MidnightBinding } from '@input-output-hk/mn-passport-adapter-midnight-js';

/** A browser host supplies policy and network ports; this package supplies the browser key source. */
export interface BrowserPassportConfig {
  /** The authorisation arm this browser host offers; P-256 remains the default. */
  readonly arm?: 'p256' | 'jubjub';
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
  readonly holdings?: VerifiedHoldingSource;
  readonly readGrants?: ActiveReadGrantTargetSource;
  readonly grants?: ActiveGrantSnapshotSource;
  readonly grantCommitments?: GrantCommitmentSource;
  readonly grantDetails?: GrantDetailSource;
  readonly grantRoster?: GrantRosterSource;
  readonly grantJournal?: GrantPublicationJournal;
  readonly records?: AccountRecordStore;
  readonly random?: (length: number) => Uint8Array;
}

/** Assemble a Passport account API without loading midnight-js until the first chain operation. */
export function createBrowserPassport(config: BrowserPassportConfig): PassportConnectorAPI {
  const passkey = webauthnPasskey(config.passkey);
  const binding = async (): Promise<MidnightBinding> =>
    typeof config.binding === 'function' ? config.binding() : config.binding;
  const jubjub = async () => {
    const pure = (await binding()).pureCircuits;
    for (const name of [
      'compute_public_point_with_jubjub',
      'derive_device_entry_with_jubjub',
      'challenge_append_inbox_with_jubjub',
    ] as const) {
      if (typeof pure[name] !== 'function') throw new Error(`ACC binding lacks ${name}`);
    }
    return recipeJubjubAuthoriser(passkey.prf, pure as typeof pure & JubjubPureCircuits);
  };
  const authoriser: Authoriser =
    config.arm === 'jubjub'
      ? {
          scheme: 'jubjub-schnorr',
          devicePublicKey: async () => (await jubjub()).devicePublicKey(),
          devicePublicKeyHex: async () => (await jubjub()).devicePublicKeyHex(),
          deviceCommitments: async (account, epoch, counters) =>
            (await jubjub()).deviceCommitments(account, epoch, counters),
          authorise: async (request) => (await jubjub()).authorise(request),
          withKeySession: (operation) => passkey.prf.withSession(operation),
        }
      : passkey.p256;
  return createPassportAccounts({
    network: config.network,
    binding,
    credentials: passkey.credentials,
    authoriser,
    encryptionKey: recipeEncryptionKey(passkey.prf),
    viewingKey: recipeDeviceKeyring(passkey.prf),
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
    ...(config.holdings && { holdings: config.holdings }),
    ...(config.readGrants && { readGrants: config.readGrants }),
    ...(config.grants && { grants: config.grants }),
    ...(config.grantCommitments && { grantCommitments: config.grantCommitments }),
    ...(config.grantDetails && { grantDetails: config.grantDetails }),
    ...(config.grantRoster && { grantRoster: config.grantRoster }),
    ...(config.grantJournal && { grantJournal: config.grantJournal }),
    grantOrigin: config.passkey.rpId,
    ...(config.records && { records: config.records }),
    ...(config.random && { random: config.random }),
  });
}
