import type {
  FeeSponsor as LaceFeeSponsor,
  GrantBookkeeping as LaceGrantBookkeeping,
  PassportAuthoriser,
  PassportEncryptionKey,
  PassportNetworkConfig,
  PassportProver,
} from './lace-contract/types';
import type { PassportAccountInfo } from './lace-contract/store/slice';
import type { GrantRecord as LaceGrantRecord } from './lace-contract/grants';
import {
  AccAddress,
  DeviceEpoch,
  GrantId,
  GrantScopeSalt,
  GrantSlot,
  TokenColor,
  UseCounter,
} from './lace-contract/value-objects';
import type { GrantScopeInput as LaceGrantScopeInput } from './lace-contract/grants';
import type { GrantScopeInput as SDKGrantScopeInput } from '@input-output-hk/mn-passport-account';
import { hostedJubjubAuthoriser } from '@input-output-hk/mn-passport-adapter-browser/hosted-jubjub';
import { createHostedAccChain } from '@input-output-hk/mn-passport-adapter-midnight-js';
import { resolveBinding } from '@input-output-hk/mn-passport-contract';
import type {
  HostedAccHandle,
  HostedAccLedger,
} from '@input-output-hk/mn-passport-adapter-midnight-js';
import type { Ledger as LaceAccLedger } from './lace-acc-generated';
import type { GatedContractHandle as LaceGatedContractHandle } from './lace-gated-handle';
import type {
  AccountViewingKey,
  AccountRecord,
  Authoriser,
  FeeSponsor,
  GrantBookkeeping,
  GrantDetailSource,
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
declare const laceAccountInfo: PassportAccountInfo;
declare const laceGrantRecord: LaceGrantRecord;
declare const laceSnapshotNonce: bigint;

const sponsor: FeeSponsor = laceSponsor;
const viewing: AccountViewingKey = laceViewing;
const grantScope: SDKGrantScopeInput = laceGrantScope;
const grantBookkeeping: GrantBookkeeping = laceGrantBookkeeping;
const network: NetworkConfig = {
  ...laceNetwork,
  bindingId: 'acc-s3r1.1',
  manifestSha256: '77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f',
};

declare const laceLedger: LaceAccLedger;
declare const laceHandle: LaceGatedContractHandle;
const hostedLedger: HostedAccLedger = laceLedger;
const hostedHandle: HostedAccHandle = laceHandle;
const hostedChain = createHostedAccChain({
  network,
  binding: { id: network.bindingId, ...resolveBinding(network.bindingId) },
  readLedger: async () => hostedLedger,
  connectHandle: async () => hostedHandle,
});
void hostedChain;

// Lace's persisted account has a network and status; this device's SDK record also needs its
// authoriser arm and local counter. The host validates the network and binding before mapping it.
function recordForDevice(
  info: PassportAccountInfo,
  expectedNetwork: string,
  expectedBinding: string,
  counter: bigint,
): AccountRecord {
  if (
    info.networkId !== expectedNetwork ||
    info.bindingVersion !== expectedBinding ||
    info.status !== 'ready'
  )
    throw new Error('Lace account does not match this device and binding');
  return {
    address: info.address,
    bindingId: expectedBinding,
    scheme: 'jubjub-schnorr',
    localUseCounter: counter,
  };
}
const deviceRecord = recordForDevice(laceAccountInfo, network.networkId, network.bindingId, 0n);

// A stored Lace grant record lacks a same-snapshot auth nonce. The host obtains that nonce from
// the live ACC grant map before it can implement GrantDetailSource.
type SDKGrantDetail = NonNullable<Awaited<ReturnType<GrantDetailSource['readGrant']>>>;
const grantDetail: SDKGrantDetail = {
  active: laceGrantRecord.active,
  read: laceGrantRecord.scope.read,
  authNonce: laceSnapshotNonce,
};

const hostedAuthoriser: Authoriser = hostedJubjubAuthoriser(laceAuthoriser, {
  account: AccAddress,
  epoch: DeviceEpoch,
  counter: UseCounter,
  flow: (descriptor) => {
    if (descriptor.kind === 'rotate-encryption-key')
      throw new Error('Lace has no rotation consent descriptor');
    return {
      kind: descriptor.kind,
      ...(descriptor.account === undefined ? {} : { account: AccAddress(descriptor.account) }),
      ...(descriptor.grantId === undefined ? {} : { grantId: GrantId(descriptor.grantId) }),
      ...(descriptor.slot === undefined ? {} : { slot: GrantSlot(descriptor.slot) }),
      ...(descriptor.scopeSalt === undefined
        ? {}
        : { scopeSalt: GrantScopeSalt(descriptor.scopeSalt) }),
      ...(descriptor.scope === undefined
        ? {}
        : { scope: { ...descriptor.scope, color: TokenColor(descriptor.scope.color) } }),
      ...(descriptor.devices === undefined ? {} : { devices: [...descriptor.devices] }),
      ...(descriptor.commitmentHex === undefined
        ? {}
        : { commitmentHex: descriptor.commitmentHex }),
      ...(descriptor.scopeDigest === undefined ? {} : { scopeDigest: descriptor.scopeDigest }),
      ...(descriptor.read === undefined ? {} : { read: descriptor.read }),
      ...(descriptor.reader === undefined ? {} : { reader: descriptor.reader }),
      ...(descriptor.lockAccount === undefined ? {} : { lockAccount: descriptor.lockAccount }),
    };
  },
});

// Structural assignment compiles; runtime branding and consent still need the hosted adapter.
const structuralAuthoriser: Authoriser = laceAuthoriser;
// This difference needs a transaction pipeline adapter.
// @ts-expect-error Lace proves a circuit preimage; the SDK proves a transaction.
const directProver: Prover = laceProver;

void [
  sponsor,
  viewing,
  grantScope,
  grantBookkeeping,
  network,
  hostedAuthoriser,
  structuralAuthoriser,
  directProver,
  deviceRecord,
  grantDetail,
];
