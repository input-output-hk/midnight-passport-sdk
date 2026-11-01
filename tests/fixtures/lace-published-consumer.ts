// Public registry declarations, not private source or locally recreated host interfaces.
import {
  m,
  createLaceWallet,
  type PassportAuthoriser,
  type PassportEncryptionKey,
  type PassportNetworkConfig,
  type PassportProver,
  type FeeSponsor as HostFeeSponsor,
  type GrantBookkeeping as HostGrantBookkeeping,
  type GrantScopeInput as HostGrantScopeInput,
  type PassportAccountInfo,
} from '@laceio/sdk/experimental';
import { createLaceWallet as createOrdinaryWallet } from '@laceio/sdk/midnight';
import {
  hostedJubjubAuthoriser,
  type HostedJubjubConversions,
} from '@input-output-hk/mn-passport-adapter-browser/hosted-jubjub';
import {
  toJubjubGrantScope,
  toJubjubGrantBookkeeping,
  jubjubGrantInbox,
} from './jubjub-grant-scope';
import { recipeDeviceKeyring } from '@input-output-hk/mn-passport-keys';
import type {
  AccountRecord,
  AccountViewingKey,
  Authoriser,
  FeeSponsor,
  GrantBookkeeping,
  NetworkConfig,
  PrfKeySource,
  Prover,
} from '@input-output-hk/mn-passport-account/ports';
import type { GrantScopeInput } from '@input-output-hk/mn-passport-account';

declare const host: Parameters<typeof m.createPassportAccountModule>[0];
declare const authoriser: PassportAuthoriser;
declare const viewing: PassportEncryptionKey;
declare const sponsor: HostFeeSponsor;
declare const circuitProver: PassportProver;
declare const hostNetwork: PassportNetworkConfig;
declare const grant: HostGrantBookkeeping;
declare const scope: HostGrantScopeInput;
declare const keySource: PrfKeySource;
declare const record: PassportAccountInfo;

const sdkViewing: AccountViewingKey = viewing;
const checkedGrantReader = jubjubGrantInbox(viewing);
void checkedGrantReader;
// The host's narrower consent union needs explicit branding and rejection of unsupported flows.
declare const conversions: HostedJubjubConversions<
  Parameters<PassportAuthoriser['deviceCommitment']>[0],
  Parameters<PassportAuthoriser['deviceCommitment']>[1],
  Parameters<PassportAuthoriser['deviceCommitment']>[2],
  Exclude<Parameters<NonNullable<PassportAuthoriser['withKeySession']>>[1], undefined>
>;
const sdkAuthoriser: Authoriser = hostedJubjubAuthoriser(authoriser, conversions);
// @ts-expect-error The raw host authoriser cannot accept every SDK flow descriptor.
const uncheckedAuthoriser: Authoriser = authoriser;
const sdkSponsor: FeeSponsor = sponsor;
const sdkGrant: GrantBookkeeping = toJubjubGrantBookkeeping(grant);
// @ts-expect-error The host also represents grantee schemes this SDK does not implement.
const uncheckedScope: GrantScopeInput = scope;
const sdkScope: GrantScopeInput = toJubjubGrantScope(scope);
const sdkNetwork: NetworkConfig = {
  ...hostNetwork,
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
};
const sdkKeys = recipeDeviceKeyring(keySource);
// @ts-expect-error Reverse mapping needs validated host branding on grant/account identifiers.
const hostViewing: PassportEncryptionKey = sdkKeys;
// @ts-expect-error Circuit proof preimages are not transaction proof requests.
const sdkProver: Prover = circuitProver;
// @ts-expect-error A persisted host record needs an explicit device/binding/counter mapping.
const sdkRecord: AccountRecord = record;

const passport = m.createPassportAccountModule(host);
const sameEntryWallet = createLaceWallet({
  modules: [passport] as const,
  environment: 'test',
  config: {},
});
const mixedEntryWallet = createOrdinaryWallet({
  // @ts-expect-error Declaration families from distinct wallet entries are not interchangeable.
  modules: [passport] as const,
  environment: 'test',
  config: {},
});

void [
  uncheckedAuthoriser,
  uncheckedScope,
  sdkViewing,
  sdkAuthoriser,
  sdkSponsor,
  sdkGrant,
  sdkScope,
  sdkNetwork,
  hostViewing,
  sdkProver,
  sdkRecord,
  sameEntryWallet,
  mixedEntryWallet,
];
