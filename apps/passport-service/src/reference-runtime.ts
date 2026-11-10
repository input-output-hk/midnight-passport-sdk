/** Type-only v9 contracts. Runtime constructors still come from the reference tree. */
import type * as Ledger from '@midnightntwrk/ledger-v9';

export interface Serialisable {
  serialize(): Uint8Array;
}
export interface V9Tx {
  readonly version: 'v9';
  readonly tx: Serialisable;
}
export type ProvenTx = Ledger.Transaction<Ledger.SignatureEnabled, Ledger.Proof, Ledger.PreBinding>;
export interface ReferenceProviders {
  readonly walletProvider: {
    balanceTx(
      tx: V9Tx,
      ttl?: Date,
    ): Promise<{ readonly version: 'v9'; readonly tx: Ledger.FinalizedTransaction }>;
    getCoinPublicKey(): string;
    getEncryptionPublicKey(): string;
  };
  readonly midnightProvider: { submitTx(tx: V9Tx): Promise<string> };
}
export interface HostProviders extends ReferenceProviders {
  readonly zkConfigProvider: { getVerifierKey(name: string): Promise<Uint8Array | undefined> };
  readonly publicDataProvider: {
    queryContractState(address: string): Promise<Serialisable | null | undefined>;
  };
}
export interface SetupModule {
  setupWallet(seed: string): Promise<{ providers: ReferenceProviders & HostProviders }>;
  compiledAccountContract(): unknown;
}
export interface Wave {
  readonly index: number;
  readonly kind: 'deploy' | 'maintenance';
  readonly circuits: readonly string[];
  readonly verifierBytes: number;
  readonly retiresAuthority: boolean;
}
export interface WavePlanner {
  allCircuits(): string[];
  planWaves(
    sizes: Map<string, number>,
    firstArm: 'p256' | 'jubjub',
    retireAuthority: boolean,
  ): readonly Wave[];
}
export interface WaveDeployModule extends WavePlanner {
  deployAccountInWaves(
    providers: ReferenceProviders,
    compiledContract: unknown,
    options: {
      firstArm: 'p256' | 'jubjub';
      args: unknown[];
      privateStateId: string;
      initialPrivateState: unknown;
      retireAuthority: boolean;
    },
  ): Promise<string>;
}
export interface SignerModule {
  JubjubDevice: { generate(): { readonly pk: unknown } };
}
export interface WitnessesModule {
  emptyCoinStore(): unknown;
}
/** The current runtime creates the signing key; do not change recovery authority to satisfy an upstream options declaration. */
export interface DeployBuilder {
  createUnprovenDeployTx(
    providers: HostProviders,
    options: {
      compiledContract: unknown;
      privateStateId: string;
      initialPrivateState: unknown;
      args: unknown[];
    },
  ): Promise<{
    readonly public: { readonly initialContractState: Serialisable };
    readonly private: { readonly signingKey: Ledger.SigningKey };
  }>;
}
export interface ProofProviderModule {
  httpClientProvingProvider(url: string, zkConfig: unknown): Ledger.ProvingProvider;
}
export interface ZkConfigModule {
  nodeZkConfigRegistry(root: string): Promise<unknown>;
}
export interface ProtocolModule {
  versionOfRecord(record: unknown): string;
}
export type LedgerModule = Pick<
  typeof Ledger,
  | 'Transaction'
  | 'ContractState'
  | 'ContractDeploy'
  | 'ContractMaintenanceAuthority'
  | 'Intent'
  | 'MaintenanceUpdate'
  | 'ReplaceAuthority'
  | 'VerifierKeyInsert'
  | 'ContractOperationVersionedVerifierKey'
  | 'signData'
  | 'ContractCall'
  | 'CostModel'
  | 'signatureVerifyingKey'
>;
export interface ReferenceHostRuntime {
  readonly ledger: LedgerModule;
  readonly versionOfRecord: ProtocolModule['versionOfRecord'];
  readonly contracts: DeployBuilder;
  readonly waves: WavePlanner;
  readonly signer: SignerModule;
  readonly setup: Pick<SetupModule, 'compiledAccountContract'>;
  readonly witnesses: WitnessesModule;
  readonly providers: HostProviders;
  readonly proving: Ledger.ProvingProvider;
  readonly networkId: string;
  readonly indexerUrl: string;
  readonly allowedAccount: (address: string) => boolean;
  readonly deploymentCompleted: (address: string) => void;
  readonly fetch?: typeof fetch;
}
