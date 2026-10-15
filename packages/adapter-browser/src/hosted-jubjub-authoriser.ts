import { jubjub } from '@noble/curves/misc.js';
import type {
  Authoriser,
  FlowDescriptor,
  JubjubAuthorisation,
} from '@input-output-hk/mn-passport-account/ports';

/** The request Lace's hosted signer accepts, before its branded values are applied. */
export interface HostedJubjubRequest<Account extends string, Counter extends bigint> {
  account: Account;
  circuit: string;
  args: readonly unknown[];
  witnessValues: readonly unknown[];
  authNonce: bigint;
  useCounter: Counter;
}

/** Structural host seam; Lace's PassportAuthoriser fits after type inference. */
export interface HostedJubjubAuthoriser<
  Account extends string,
  Epoch extends bigint,
  Counter extends bigint,
  Commitment extends string,
  Flow,
> {
  readonly scheme: 'jubjub-schnorr';
  deviceCommitment(account: Account, epoch: Epoch, counter: Counter): Promise<Commitment>;
  deviceCommitments?(
    account: Account,
    epoch: Epoch,
    counters: readonly Counter[],
  ): Promise<Commitment[]>;
  devicePublicKey(): Promise<{ x: bigint; y: bigint }>;
  authorise(request: HostedJubjubRequest<Account, Counter>): Promise<JubjubAuthorisation>;
  withKeySession?<T>(operation: () => Promise<T>, flow?: Flow): Promise<T>;
  storageKey?: () => Promise<CryptoKey>;
}

/** The host owns tagged constructors and exact consent encoding. */
export interface HostedJubjubConversions<
  Account extends string,
  Epoch extends bigint,
  Counter extends bigint,
  Flow,
> {
  account(value: string): Account;
  epoch(value: bigint): Epoch;
  counter(value: bigint): Counter;
  flow(descriptor: FlowDescriptor): Flow;
}

const sameConsent = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((item, index) => sameConsent(item, right[index]))
    );
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftFields = Object.entries(left).filter(([, value]) => value !== undefined);
  const rightFields = Object.entries(right).filter(([, value]) => value !== undefined);
  return (
    leftFields.length === rightFields.length &&
    leftFields.every(
      ([name, value]) =>
        Object.hasOwn(right, name) && sameConsent(value, (right as Record<string, unknown>)[name]),
    )
  );
};

/**
 * Bridges a hosted JubJub signer to the account port without importing Lace.
 * The host's flow converter may brand or validate values but must preserve
 * every consent field; this adapter checks its output before opening a session.
 * This adapter refuses operations without a Lace PR #2845 consent kind;
 * passing them through as another kind would mislead the user.
 */
export function hostedJubjubAuthoriser<
  Account extends string,
  Epoch extends bigint,
  Counter extends bigint,
  Commitment extends string,
  Flow,
>(
  source: HostedJubjubAuthoriser<Account, Epoch, Counter, Commitment, Flow>,
  convert: HostedJubjubConversions<Account, Epoch, Counter, Flow>,
): Authoriser &
  Required<Pick<Authoriser, 'deviceCommitments' | 'devicePublicKeyHex' | 'withKeySession'>> {
  if (source.scheme !== 'jubjub-schnorr')
    throw new Error('the hosted authoriser must use JubJub Schnorr');
  const withKeySession = source.withKeySession;
  if (!withKeySession) throw new Error('the hosted JubJub signer needs a key session');
  const validatedPoint = async () => {
    const point = jubjub.Point.fromAffine(await source.devicePublicKey());
    point.assertValidity();
    return point;
  };
  const deviceCommitments = async (account: string, epoch: bigint, counters: readonly bigint[]) => {
    const brandedAccount = convert.account(account);
    const brandedEpoch = convert.epoch(epoch);
    const brandedCounters = counters.map(convert.counter);
    return source.deviceCommitments
      ? source.deviceCommitments(brandedAccount, brandedEpoch, brandedCounters)
      : Promise.all(
          brandedCounters.map((counter) =>
            source.deviceCommitment(brandedAccount, brandedEpoch, counter),
          ),
        );
  };
  return {
    scheme: 'jubjub-schnorr',
    devicePublicKey: async () => (await validatedPoint()).toAffine(),
    devicePublicKeyHex: async () => {
      const point = await validatedPoint();
      return Array.from(point.toBytes(), (byte) => byte.toString(16).padStart(2, '0')).join('');
    },
    deviceCommitments,
    authorise: (request) => {
      if (!/(?:_with_jubjub|_jubjub)$/.test(request.circuit))
        throw new Error('the requested circuit does not use the JubJub arm');
      return source
        .authorise({
          account: convert.account(request.account),
          circuit: request.circuit,
          args: request.args,
          witnessValues: request.witnessValues,
          authNonce: request.authNonce,
          useCounter: convert.counter(request.useCounter),
        })
        .then((signed) => {
          if (signed.scheme !== 'jubjub-schnorr')
            throw new Error('the hosted signer returned a non-JubJub authorisation');
          return signed;
        });
    },
    withKeySession: (operation, descriptor) => {
      if (
        descriptor?.kind === 'rotate-encryption-key' ||
        descriptor?.kind === 'withdraw-unshielded'
      )
        throw new Error(`the hosted signer has no ${descriptor.kind} consent descriptor`);
      const flow = descriptor === undefined ? undefined : convert.flow(descriptor);
      if (descriptor !== undefined && !sameConsent(descriptor, flow))
        throw new Error('the hosted signer consent descriptor changed during branding');
      return withKeySession(operation, flow);
    },
    ...(source.storageKey ? { storageKey: source.storageKey } : {}),
  };
}
