import { z } from 'zod';
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import type { FlowDescriptor } from './ports/index.js';
import {
  AccountContextSchema,
  UnshieldedWithdrawalSchema,
  type AccountContext,
} from './validation.js';

export type AuthorisationRoute = 'primary' | 'authenticated-owner';
export interface AccountConsent {
  readonly context: AccountContext;
  readonly route: AuthorisationRoute;
  readonly scheme: PassportAccount['scheme'];
  /** Review data, not a public audit payload: grant metadata may be privacy-sensitive. Never key material or witnesses. */
  readonly flow: FlowDescriptor;
}
export interface AccountConsentPort {
  /** Explicit host decision. Authentication alone never supplies operation consent. */
  review(request: AccountConsent): Promise<boolean>;
}
export interface AuthenticatedAccount {
  readonly account: PassportAccount;
  /** Host-owned expiry, revision and live-owner lease. Must throw after lock or replacement. */
  check(): void;
}
export class AccountAuthorisationError extends Error {
  constructor(readonly code: 'InvalidContext' | 'Unavailable' | 'Declined') {
    super(`Account authorisation: ${code}.`);
    this.name = 'AccountAuthorisationError';
  }
}

const text = z.string().min(1).max(1024);
const hex = z.string().regex(/^[0-9a-f]{64}$/);
const decimal = z
  .string()
  .max(39)
  .regex(/^(?:0|[1-9][0-9]*)$/);
const scopeSchema = z.object({
  grantee: z.object({ scheme: z.literal('jubjub-schnorr'), publicKey: hex }),
  operations: z
    .array(z.enum(['withdraw-unshielded', 'withdraw-shielded', 'withdraw-shielded-to-contract']))
    .min(1)
    .max(3),
  color: hex,
  recipient: z.union([
    z.object({ kind: z.literal('any') }),
    z.object({ kind: z.enum(['coin-public-key', 'contract-address', 'user-address']), value: hex }),
  ]),
  maxCoinValue: decimal,
  perCallCap: decimal,
  cap: decimal,
  expiresAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  window: z.object({ lengthSeconds: z.number().int().positive(), cap: decimal }).optional(),
  read: z.boolean().optional(),
  readPublicKey: hex.optional(),
  caller: hex.optional(),
  rpId: text.optional(),
});
const flowSchema = z.object({
  kind: z.enum([
    'create-account',
    'sign-in',
    'rotate-encryption-key',
    'add-device',
    'remove-device',
    'read-holdings',
    'issue-grant',
    'revoke-grant',
    'revoke-all-grants',
    'withdraw-unshielded',
    'withdraw-shielded',
  ]),
  commitmentHex: hex.optional(),
  account: hex.optional(),
  grantId: hex.optional(),
  scope: scopeSchema.optional(),
  scopeSalt: hex.optional(),
  scopeDigest: hex.optional(),
  slot: z.number().int().min(0).max(255).optional(),
  read: z.boolean().optional(),
  devices: z.array(hex).max(256).optional(),
  lockAccount: z.boolean().optional(),
  color: hex.optional(),
  amount: decimal.optional(),
  recipient: hex.optional(),
  inboxIndex: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  reader: z
    .object({
      readerPublicKey: hex,
      devicePublicKey: z.string().regex(/^(?:[0-9a-f]{64}|[0-9a-f]{66})$/),
      scheme: z.enum(['jubjub-schnorr', 'p256-webauthn']).optional(),
      policy: z
        .object({
          rp_id_hash: z.instanceof(Uint8Array).refine((bytes) => bytes.length === 32),
          origin: z.instanceof(Uint8Array).refine((bytes) => bytes.length === 21),
        })
        .optional(),
    })
    .optional(),
});
/** Validate, strip provider extensions and copy byte fields before awaiting consent. */
function copyFlow(flow: FlowDescriptor): FlowDescriptor {
  const parsed = flowSchema.safeParse(flow);
  if (!parsed.success) throw new AccountAuthorisationError('InvalidContext');
  // Zod's optional fields include undefined, whereas the port uses exact optional
  // properties. It accepts absence/undefined identically; only this boundary bridges them.
  const copy = parsed.data as FlowDescriptor;
  if (
    (copy.kind === 'withdraw-unshielded' || copy.kind === 'withdraw-shielded') &&
    (!UnshieldedWithdrawalSchema.safeParse(copy).success ||
      (copy.kind === 'withdraw-shielded' && copy.inboxIndex === undefined))
  )
    throw new AccountAuthorisationError('InvalidContext');
  if (
    (copy.kind === 'issue-grant' && !copy.scope) ||
    (copy.kind === 'revoke-grant' && !copy.grantId) ||
    (copy.kind === 'remove-device' && !copy.commitmentHex) ||
    (copy.kind === 'add-device' && !copy.commitmentHex && !copy.reader)
  )
    throw new AccountAuthorisationError('InvalidContext');
  if (copy.reader?.policy) {
    const policy = copy.reader.policy;
    return Object.freeze({
      ...copy,
      reader: {
        ...copy.reader,
        policy: {
          rp_id_hash: Uint8Array.from(policy.rp_id_hash),
          origin: Uint8Array.from(policy.origin),
        },
      },
    });
  }
  return Object.freeze(copy);
}

/**
 * One operation chooses one signer route before consent. No silent fallback and no proxy
 * scheme substitution inside an existing connector. The host first opens/verifies each
 * candidate using its matching binding, then supplies that account and its checked lease.
 */
export function createAccountAuthorisation(options: {
  primary: PassportAccount;
  /** Synchronous host scope check; return true only while the captured account/authentication revision is current. */
  isContextCurrent(): boolean;
  authenticated?: () => AuthenticatedAccount | undefined;
  consent: AccountConsentPort;
}) {
  const { primary, isContextCurrent } = options;
  if (typeof isContextCurrent !== 'function') throw new AccountAuthorisationError('InvalidContext');
  const checkContext = () => {
    if (isContextCurrent() !== true) throw new AccountAuthorisationError('Unavailable');
  };
  const context = AccountContextSchema.parse({
    account: primary.address,
    networkId: primary.networkId,
    bindingId: primary.bindingId,
  });
  const sameAccount = (account: PassportAccount) =>
    account.address === context.account &&
    account.networkId === context.networkId &&
    account.bindingId === context.bindingId;
  return Object.freeze({
    async run<T>(
      request: { route: AuthorisationRoute; flow: FlowDescriptor },
      work: (account: PassportAccount, approved: AccountConsent) => Promise<T>,
    ): Promise<T> {
      checkContext();
      const { route } = request;
      if (
        !['primary', 'authenticated-owner'].includes(route) ||
        !sameAccount(primary) ||
        (request.flow.account !== undefined && request.flow.account !== context.account) ||
        request.flow.kind === 'create-account'
      )
        throw new AccountAuthorisationError('InvalidContext');
      const candidate = route === 'authenticated-owner' ? options.authenticated?.() : undefined;
      if (
        route === 'authenticated-owner' &&
        (!candidate || candidate.account.scheme !== 'jubjub-schnorr')
      )
        throw new AccountAuthorisationError('Unavailable');
      const account = candidate?.account ?? primary;
      if (!sameAccount(account)) throw new AccountAuthorisationError('InvalidContext');
      candidate?.check();
      const flow = copyFlow({ ...request.flow, account: context.account });
      const approved = await options.consent.review(
        Object.freeze({ context, route, scheme: account.scheme, flow: copyFlow(flow) }),
      );
      if (approved !== true) throw new AccountAuthorisationError('Declined');
      // Lock/replacement while the consent UI was open never chooses another key path.
      const checkCurrent = () => {
        checkContext();
        candidate?.check();
        if (!sameAccount(account)) throw new AccountAuthorisationError('InvalidContext');
        if (candidate) {
          const current = options.authenticated?.();
          if (!current || current.account !== account || current.check !== candidate.check)
            throw new AccountAuthorisationError('Unavailable');
        }
      };
      checkCurrent();
      const result = await work(
        account,
        Object.freeze({ context, route, scheme: account.scheme, flow: copyFlow(flow) }),
      );
      if (flow.kind === 'read-holdings' || flow.kind === 'sign-in') checkCurrent();
      // Mutation receipts survive local expiry after dispatch. The selected connector's
      // transports still guard every new dispatch, and its journal owns reconciliation.
      return result;
    },
  });
}

/**
 * Compatibility facade for hosts that already review and pin a route externally.
 * Prefer createAccountAuthorisation for new integrations. Never grants authority itself.
 */
export function routeAuthenticatedAccount(
  primary: PassportAccount,
  selected: () => PassportAccount | undefined,
  check: () => void,
): PassportAccount {
  return new Proxy(primary, {
    get(target, property) {
      if (['state', 'deviceRoster', 'grantRoster'].includes(String(property))) {
        const read: unknown = Reflect.get(target, property);
        return typeof read === 'function' ? read.bind(target) : read;
      }
      const current = selected() ?? target;
      if (
        current.address !== primary.address ||
        current.networkId !== primary.networkId ||
        current.bindingId !== primary.bindingId
      )
        throw new AccountAuthorisationError('InvalidContext');
      const value: unknown = Reflect.get(current, property);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        check();
        const chosen = selected() ?? target;
        if (chosen !== current) throw new AccountAuthorisationError('Unavailable');
        const operation: unknown = Reflect.get(chosen, property);
        if (typeof operation !== 'function') throw new AccountAuthorisationError('Unavailable');
        return Reflect.apply(operation, chosen, args);
      };
    },
  });
}
