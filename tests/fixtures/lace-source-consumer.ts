import type {
  FeeSponsor as LaceFeeSponsor,
  GrantBookkeeping as LaceGrantBookkeeping,
  PassportAuthoriser,
  PassportEncryptionKey,
  PassportNetworkConfig,
  PassportProver,
} from './lace-contract/types';
import type { GrantScopeInput as LaceGrantScopeInput } from './lace-contract/grants';
import type { GrantScopeInput as SDKGrantScopeInput } from '@input-output-hk/mn-passport-account';
import type {
  AccountViewingKey,
  Authoriser,
  FeeSponsor,
  GrantBookkeeping,
  NetworkConfig,
  Prover,
} from '@input-output-hk/mn-passport-account/ports';

declare const laceSponsor: LaceFeeSponsor;
declare const laceViewing: PassportEncryptionKey;
declare const laceNetwork: PassportNetworkConfig;
declare const laceAuthoriser: PassportAuthoriser;
declare const laceProver: PassportProver;
declare const laceGrantScope: LaceGrantScopeInput;
declare const laceGrantBookkeeping: LaceGrantBookkeeping;

const sponsor: FeeSponsor = laceSponsor;
const viewing: AccountViewingKey = laceViewing;
const grantScope: SDKGrantScopeInput = laceGrantScope;
const grantBookkeeping: GrantBookkeeping = laceGrantBookkeeping;
const network: NetworkConfig = {
  ...laceNetwork,
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
};

// These differences are intentional and need real host adapters.
// @ts-expect-error Lace's branded request and key-session descriptor differ from the SDK port.
const directAuthoriser: Authoriser = laceAuthoriser;
// @ts-expect-error Lace proves a circuit preimage; the SDK proves a transaction.
const directProver: Prover = laceProver;

void [sponsor, viewing, grantScope, grantBookkeeping, network, directAuthoriser, directProver];
