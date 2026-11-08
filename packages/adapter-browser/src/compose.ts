import { authenticatedOwnerTransports } from './authenticated-transports.js';
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
  Chain,
  Deployer,
  FeeSponsor,
  Lazy,
  JubjubPureCircuits,
  NetworkConfig,
  Prover,
  PrfKeySource,
  PassportPorts,
  Submitter,
  VerifiedHoldingSource,
} from '@input-output-hk/mn-passport-account/ports';
import type { GrantPublicationJournal } from '@input-output-hk/mn-passport-account';
import { webauthnPasskey } from '@input-output-hk/mn-passport-adapter-webauthn';
import type {
  PasskeyCeremonyOptions,
  PasskeyLoginKeys,
} from '@input-output-hk/mn-passport-adapter-webauthn';
import {
  recipeDeviceKeyring,
  recipeEncryptionKey,
  recipeJubjubAuthoriser,
  type AuthenticatedJubjubOwner,
} from '@input-output-hk/mn-passport-keys';
import type { PassportAccount, PassportConnectorAPI } from '@input-output-hk/mn-passport-protocol';
import type { MidnightBinding } from '@input-output-hk/mn-passport-adapter-midnight-js';

export type BrowserLoginKeys = PasskeyLoginKeys;

/** A browser host supplies policy and network ports; this package supplies the browser key source. */
export interface BrowserPassportConfig {
  /** Explicitly authenticated, account-bound software owner. Never creates an ACC. */
  readonly ownerSession?: AuthenticatedJubjubOwner;
  /** The authorisation arm this browser host offers; P-256 remains the default. */
  readonly arm?: 'p256' | 'jubjub';
  readonly network: NetworkConfig;
  readonly binding: Lazy<MidnightBinding>;
  readonly passkey: PasskeyCeremonyOptions & {
    readonly rpId: string;
    readonly origin: string;
    readonly credentials?: CredentialsContainer;
  };
  /** Opt-in adoption of root-derived routine keys after verified open, before login scope disposal.
   * The keys expose wallet derivation only and become invalid when this callback's login ends.
   * Not called for authenticated ownerSession compositions or account creation. */
  readonly onAccountOpened?: (account: PassportAccount, keys: BrowserLoginKeys) => Promise<void>;
  readonly prover: Prover;
  readonly sponsor: FeeSponsor;
  readonly sponsorKeys: { readonly coinPublicKey: string; readonly encryptionPublicKey: string };
  readonly submitter: Submitter;
  /** Host-owned value-capable call path for ACC withdrawals; the fee sponsor cannot move value. */
  readonly valueCalls?: Pick<Chain, 'call'>;
  readonly deployer: Deployer;
  readonly directory: AccountDirectory;
  readonly holdings?: VerifiedHoldingSource;
  readonly routineViewingKey?: PassportPorts['routineViewingKey'];
  readonly readGrants?: ActiveReadGrantTargetSource;
  readonly grants?: ActiveGrantSnapshotSource;
  readonly grantCommitments?: GrantCommitmentSource;
  readonly grantDetails?: GrantDetailSource;
  readonly grantRoster?: GrantRosterSource;
  readonly grantJournal?: GrantPublicationJournal;
  /** Share the selected passkey PRF with a host's encrypted publication journal. */
  readonly grantJournalFactory?: (prf: PrfKeySource) => GrantPublicationJournal;
  readonly records?: AccountRecordStore;
  readonly random?: (length: number) => Uint8Array;
}

/** Assemble a Passport account API without loading midnight-js until the first chain operation. */
export function createBrowserPassport(config: BrowserPassportConfig): PassportConnectorAPI {
  const owner = config.ownerSession;
  const onAccountOpened = config.onAccountOpened;
  if (
    owner &&
    (config.arm !== 'jubjub' ||
      owner.context.networkId !== config.network.networkId ||
      owner.context.bindingId !== config.network.bindingId)
  )
    throw new Error('Authenticated owner composition context mismatch.');
  const transports = owner ? authenticatedOwnerTransports(() => owner.check(), config) : config;
  const passkey = webauthnPasskey(config.passkey);
  const prf = owner?.prf ?? passkey.prf;
  const grantJournal = config.grantJournal ?? config.grantJournalFactory?.(prf);
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
    return recipeJubjubAuthoriser(prf, pure as typeof pure & JubjubPureCircuits);
  };
  const authoriser: Authoriser =
    owner?.authoriser ??
    (config.arm === 'jubjub'
      ? {
          scheme: 'jubjub-schnorr',
          devicePublicKey: async () => (await jubjub()).devicePublicKey(),
          devicePublicKeyHex: async () => (await jubjub()).devicePublicKeyHex(),
          deviceCommitments: async (account, epoch, counters) =>
            (await jubjub()).deviceCommitments(account, epoch, counters),
          authorise: async (request) => (await jubjub()).authorise(request),
          withKeySession: (operation) => prf.withSession(operation),
        }
      : passkey.p256);
  const api = createPassportAccounts({
    network: config.network,
    binding,
    credentials: owner?.credentials ?? passkey.credentials,
    ...(!owner &&
      onAccountOpened && {
        onAccountOpened: (account: PassportAccount) =>
          onAccountOpened(account, passkey.readLoginKeys(account.credentialId)),
      }),
    authoriser,
    encryptionKey: recipeEncryptionKey(prf),
    viewingKey: recipeDeviceKeyring(prf),
    chain: async () => {
      const [{ createMidnightChain }, module] = await Promise.all([
        import('@input-output-hk/mn-passport-adapter-midnight-js'),
        binding(),
      ]);
      const chain = createMidnightChain({
        network: config.network,
        binding: module,
        prover: transports.prover,
        sponsor: transports.sponsor,
        sponsorKeys: config.sponsorKeys,
        submitter: transports.submitter,
      });
      if (!transports.valueCalls) return chain;
      return {
        readAccount: chain.readAccount,
        call: (request) =>
          request.circuit.startsWith('withdraw_unshielded')
            ? transports.valueCalls!.call(request)
            : chain.call(request),
      };
    },
    deployer: config.deployer,
    directory: config.directory,
    ...(config.holdings && { holdings: config.holdings }),
    ...(config.routineViewingKey && { routineViewingKey: config.routineViewingKey }),
    ...(config.readGrants && { readGrants: config.readGrants }),
    ...(config.grants && { grants: config.grants }),
    ...(config.grantCommitments && { grantCommitments: config.grantCommitments }),
    ...(config.grantDetails && { grantDetails: config.grantDetails }),
    ...(config.grantRoster && { grantRoster: config.grantRoster }),
    ...(grantJournal && { grantJournal }),
    grantOrigin: config.passkey.rpId,
    ...(config.records && { records: config.records }),
    ...(config.random && { random: config.random }),
  });
  if (!owner) return api;
  const open: NonNullable<PassportConnectorAPI['openAccountAt']> = (address, options) => {
    owner.check();
    if (address !== owner.context.account) throw new Error('Authenticated owner account mismatch.');
    return api.openAccountAt!(address, options);
  };
  return {
    ...api,
    createAccount: async () => {
      throw new Error('Authenticate through the passkey to create an account.');
    },
    openAccount: (options) => open(owner.context.account, options),
    openAccountAt: open,
  };
}
