import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type { PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type {
  ActiveGrantSnapshotSource,
  ActiveReadGrantTargetSource,
  GrantDetailSource,
  GrantRosterSource,
  NetworkConfig,
} from '@input-output-hk/mn-passport-account/ports';

type Grant = {
  readonly active: boolean;
  readonly scope: { readonly read: boolean; readonly read_pk_hash: Uint8Array };
};
type GrantLedger = {
  readonly auth_nonce: bigint;
  readonly grant_generation: bigint;
  readonly grants: {
    size(): bigint;
    [Symbol.iterator](): Iterator<[Uint8Array, Grant]>;
  };
};
type ListedGrant = {
  readonly id: string;
  readonly active: boolean;
  readonly read: boolean;
  readonly readHash: Uint8Array;
};

/** Durable local openings; an inbox-only claim is not trusted until its key hashes to the ledger. */
export interface ReadGrantOpeningSource {
  readReadPublicKey(account: string, grantId: string): Promise<string | undefined>;
}

export interface MidnightGrantSourceOptions {
  readonly network: Pick<NetworkConfig, 'networkId' | 'bindingId' | 'indexerUrl' | 'indexerWsUrl'>;
  readonly binding: { ledger(data: unknown): unknown };
  readonly openings: ReadGrantOpeningSource;
  readonly publicDataProvider?: PublicDataProvider;
}

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const bytes32 = (value: string): Uint8Array<ArrayBuffer> | undefined =>
  /^[0-9a-f]{64}$/.test(value)
    ? Uint8Array.from(value.match(/.{2}/g)!, (pair) => Number.parseInt(pair, 16))
    : undefined;
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** One checked ACC grant-map snapshot shared by the issue, revoke and rotation owner ports. */
export function createMidnightGrantSource(
  options: MidnightGrantSourceOptions,
): ActiveGrantSnapshotSource & GrantDetailSource & ActiveReadGrantTargetSource & GrantRosterSource {
  const { network, binding, openings } = options;
  if (network.bindingId !== 'acc-s3r1.1')
    throw new PassportConnectorError('BindingUnsupported', 'Unsupported ACC grant binding.');
  const provider =
    options.publicDataProvider ??
    indexerPublicDataProvider({
      queryURL: network.indexerUrl,
      subscriptionURL: network.indexerWsUrl,
    });
  const snapshot = async (account: string) => {
    if (!bytes32(account))
      throw new PassportConnectorError('AccountNotFound', 'Invalid ACC address.');
    setNetworkId(network.networkId);
    const state = await provider.queryContractState(account);
    if (!state) throw new PassportConnectorError('AccountNotFound', 'The ACC is missing.');
    const ledger = binding.ledger(state.data) as GrantLedger;
    if (
      typeof ledger?.auth_nonce !== 'bigint' ||
      ledger.auth_nonce < 0n ||
      typeof ledger.grant_generation !== 'bigint' ||
      ledger.grant_generation < 0n ||
      ledger.grant_generation >= 1n << 32n ||
      !ledger.grants ||
      typeof ledger.grants.size !== 'function' ||
      typeof ledger.grants[Symbol.iterator] !== 'function' ||
      ledger.grants.size() < 0n ||
      ledger.grants.size() > 4096n
    )
      throw new PassportConnectorError('BindingUnsupported', 'The ACC grant map is invalid.');
    const grants: ListedGrant[] = [];
    const ids = new Set<string>();
    for (const [rawId, record] of ledger.grants) {
      if (
        !(rawId instanceof Uint8Array) ||
        rawId.length !== 32 ||
        typeof record?.active !== 'boolean' ||
        typeof record.scope?.read !== 'boolean' ||
        !(record.scope?.read_pk_hash instanceof Uint8Array) ||
        record.scope.read_pk_hash.length !== 32
      )
        throw new PassportConnectorError('BindingUnsupported', 'Malformed ACC grant record.');
      const id = hex(rawId);
      if (ids.has(id))
        throw new PassportConnectorError('BindingUnsupported', 'Duplicate ACC grant id.');
      ids.add(id);
      grants.push({
        id,
        active: record.active,
        read: record.scope.read,
        readHash: record.scope.read_pk_hash.slice(),
      });
    }
    if (grants.length !== Number(ledger.grants.size()))
      throw new PassportConnectorError(
        'BindingUnsupported',
        'The ACC grant count is inconsistent.',
      );
    return { authNonce: ledger.auth_nonce, generation: ledger.grant_generation, grants };
  };
  return {
    async readGrantRoster(account) {
      const { authNonce, generation, grants } = await snapshot(account);
      return {
        authNonce,
        generation,
        entries: grants.map(({ id, active, read }) => ({ id, active, read })),
      };
    },
    async readActiveGrantIds(account) {
      const { grants } = await snapshot(account);
      return grants.filter((grant) => grant.active).map((grant) => grant.id);
    },
    async readActiveGrantSnapshot(account) {
      const { authNonce, grants } = await snapshot(account);
      return { authNonce, ids: grants.filter((grant) => grant.active).map((grant) => grant.id) };
    },
    async readGrant(account, grantId) {
      if (!bytes32(grantId)) return undefined;
      const { authNonce, grants } = await snapshot(account);
      const grant = grants.find(({ id }) => id === grantId);
      return grant && { active: grant.active, read: grant.read, authNonce };
    },
    async readActiveReadGrantTargets(account) {
      const { authNonce, grants } = await snapshot(account);
      const active = grants.filter((grant) => grant.active && grant.read);
      const targets = await Promise.all(
        active.map(async ({ id, readHash }) => {
          const candidate = await openings.readReadPublicKey(account, id);
          const key = candidate && bytes32(candidate);
          if (!key) return { grantId: id };
          const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', key));
          return sameBytes(digest, readHash)
            ? { grantId: id, readPublicKey: candidate }
            : { grantId: id };
        }),
      );
      return { authNonce, targets };
    },
  };
}
