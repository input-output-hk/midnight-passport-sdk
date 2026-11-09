import { createRoutineReader } from './routine-reader.js';
import {
  prepareRoutineLogin,
  unlockRoutineMaterial,
  checkedRoutineSeed,
  type RoutineMaterial,
} from './routine-material.js';
import type { AccountViewingKey, PrfKeySource } from '@input-output-hk/mn-passport-account/ports';
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import {
  createSessionJubjubAuthoriser,
  deriveSymmetricSecret,
  READER_SECRET_DOMAIN,
  type JubjubDeviceCircuits,
  type SessionKeyContext,
  createAuthenticatedJubjubOwner,
  type AuthenticatedJubjubOwner,
} from '@input-output-hk/mn-passport-keys';

export type RoutineAccount = Pick<
  PassportAccount,
  'address' | 'networkId' | 'bindingId' | 'credentialId'
> &
  Partial<Pick<PassportAccount, 'scheme'>>;
export interface RoutineState {
  readonly status: 'locked' | 'unlocking' | 'active' | 'expired';
  readonly account?: string;
  readonly expiresAt?: number;
  readonly publicKey?: string;
  readonly authority?: 'routine' | 'owner';
  readonly ownerVerified?: boolean;
}
export interface RoutineContext {
  readonly account: string;
  readonly networkId: string;
  readonly bindingId: string;
  readonly credentialId: Uint8Array;
}

function notifyRoutine(listener: (snapshot: RoutineState) => void, snapshot: RoutineState) {
  try {
    listener(snapshot);
  } catch {
    // Observers cannot prevent key disposal, initial presentation or other listeners.
  }
}

const contextOf = (account: RoutineAccount): RoutineContext | undefined =>
  account.credentialId && {
    account: account.address,
    networkId: account.networkId,
    bindingId: account.bindingId,
    credentialId: account.credentialId.slice(),
  };

/** Host-owned, memory-only reading/wallet lease. PRF #1 (owner signing) is never retained.
 * The JubJub child has no authority until a separately approved grant is issued.
 */
export function createRoutineKeys(ports: {
  unlock(
    account: RoutineAccount,
    rpId: string,
  ): Promise<{ root: Uint8Array; authoriser: Uint8Array }>;
  pure(): Promise<JubjubDeviceCircuits>;
  now?: () => number;
  monotonic?: () => number;
}) {
  const now = ports.now ?? Date.now;
  const mono = ports.monotonic ?? (() => performance.now());
  let state: RoutineState = Object.freeze({ status: 'locked' });
  let bound: RoutineContext | undefined;
  let seed: Uint8Array | undefined;
  let reader: Uint8Array | undefined;
  let owner: AuthenticatedJubjubOwner | undefined;
  let origin = '';
  let credentialScope: Readonly<{ rpId: string; origin: string }> | undefined;
  let revision = 0,
    deadline = 0,
    lastWall = 0,
    lastMono = 0;
  const children = new Set<{ dispose(): void }>();
  const listeners = new Set<(snapshot: RoutineState) => void>();
  const publish = (next: RoutineState) => {
    state = Object.freeze(next);
    for (const listener of listeners) notifyRoutine(listener, state);
  };
  const lock = (status: 'locked' | 'expired' = 'locked') => {
    revision++;
    seed?.fill(0);
    reader?.fill(0);
    seed = reader = undefined;
    owner?.dispose();
    owner = undefined;
    for (const child of children) child.dispose();
    children.clear();
    bound = undefined;
    credentialScope = undefined;
    publish({ status });
  };
  const tick = () => {
    if (state.status === 'active') {
      const wall = now(),
        monotonic = mono();
      if (
        !Number.isFinite(wall) ||
        !Number.isFinite(monotonic) ||
        wall < lastWall ||
        monotonic < lastMono ||
        wall >= state.expiresAt! ||
        monotonic >= deadline
      )
        lock('expired');
      lastWall = wall;
      lastMono = monotonic;
    }
    return state;
  };
  const matches = (context: RoutineContext) => {
    tick();
    return (
      !!bound &&
      !!seed &&
      state.status === 'active' &&
      bound.account === context.account &&
      bound.networkId === context.networkId &&
      bound.bindingId === context.bindingId &&
      bound.credentialId.length === context.credentialId.length &&
      bound.credentialId.every((b, i) => b === context.credentialId[i])
    );
  };
  const check = (context: RoutineContext, version: number) => {
    if (!matches(context) || revision !== version)
      throw new Error('Quick actions are locked or expired. Unlock again with your passkey.');
  };
  const source: PrfKeySource = {
    withSession: (work) => work(),
    deviceSecret: async () => {
      throw new Error('Quick actions cannot access an owner signing key.');
    },
    deriveSecret: async (params) => {
      tick();
      if (!seed) throw new Error('Quick actions are locked.');
      return deriveSymmetricSecret(seed, params);
    },
  };
  const activate = async (
    account: RoutineAccount,
    minutes: number,
    rpId: string,
    pageOrigin: string,
    fullOwner: boolean,
    load: (context: RoutineContext) => Promise<RoutineMaterial>,
  ) => {
    const context = contextOf(account);
    const scheme = account.scheme;
    if (
      !context ||
      !/^[0-9a-f]{64}$/.test(context.account) ||
      ![10, 15, 30].includes(minutes) ||
      !rpId ||
      !pageOrigin
    )
      throw new Error('Open a passkey-backed account and select 10, 15 or 30 minutes.');
    lock();
    const version = revision;
    const wall = now(),
      monotonic = mono();
    if (!Number.isFinite(wall) || !Number.isFinite(monotonic))
      throw new Error('Invalid session clock.');
    const expiresAt = wall + minutes * 60_000;
    publish({ status: 'unlocking', account: context.account });
    let candidate: Uint8Array | undefined;
    let candidateOwner: AuthenticatedJubjubOwner | undefined;
    try {
      const pure = await ports.pure();
      if (version !== revision) throw new Error('Quick-actions unlock was cancelled.');
      const material = await load(context);
      try {
        candidate = checkedRoutineSeed(material.seed);
        if (fullOwner) {
          if (!material.ownerSecret) throw new Error('Owner material is unavailable.');
          candidateOwner = createAuthenticatedJubjubOwner({
            context,
            authoriser: material.ownerSecret,
            walletSeed: candidate,
            pure,
            companionReader: scheme !== 'jubjub-schnorr',
            check: () => check(context, version),
          });
        }
      } finally {
        material.ownerSecret?.fill(0);
      }
      if (version !== revision) throw new Error('Quick-actions unlock was cancelled.');
      if (version !== revision || now() >= expiresAt || mono() >= monotonic + minutes * 60_000)
        throw new Error('Quick-actions unlock was cancelled or expired.');
      const localSeed = candidate;
      const initialSource: PrfKeySource = {
        withSession: (work) => work(),
        deviceSecret: source.deviceSecret,
        deriveSecret: async (params) => deriveSymmetricSecret(localSeed, params),
      };
      const child = candidateOwner
        ? undefined
        : await createSessionJubjubAuthoriser(
            initialSource,
            pure,
            {
              ...context,
              origin: pageOrigin,
              sessionId:
                crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', ''),
              expiresAt,
            },
            now,
          );
      if (version !== revision || now() >= expiresAt || mono() >= monotonic + minutes * 60_000) {
        child?.dispose();
        throw new Error('Quick-actions unlock was cancelled or expired.');
      }
      seed = candidate;
      candidate = undefined;
      bound = context;
      // The existing grant protocol uses the trusted RP ID as its origin scope.
      origin = rpId;
      credentialScope = Object.freeze({ rpId, origin: pageOrigin });
      reader = deriveSymmetricSecret(seed, {
        domain: READER_SECRET_DOMAIN,
        context: context.networkId,
      });
      deadline = monotonic + minutes * 60_000;
      lastWall = wall;
      lastMono = monotonic;
      owner = candidateOwner;
      candidateOwner = undefined;
      if (child) children.add(child);
      publish({
        status: 'active',
        account: context.account,
        expiresAt,
        publicKey: owner?.publicKey ?? child!.publicKey,
        authority: owner ? 'owner' : 'routine',
      });
    } catch (error) {
      if (version === revision) lock();
      throw error;
    } finally {
      candidate?.fill(0);
      candidateOwner?.dispose();
    }
  };
  return {
    snapshot: tick,
    subscribe(listener: (snapshot: RoutineState) => void) {
      listeners.add(listener);
      notifyRoutine(listener, tick());
      return () => {
        listeners.delete(listener);
      };
    },
    lock: () => lock(),
    lease(account: RoutineAccount): (() => void) | undefined {
      const context = contextOf(account);
      if (!context || !matches(context)) return undefined;
      const version = revision;
      return () => check(context, version);
    },
    matches(account: RoutineAccount) {
      const context = contextOf(account);
      return !!context && matches(context);
    },
    async unlock(
      account: RoutineAccount,
      minutes: number,
      rpId: string,
      pageOrigin: string,
      fullOwner = false,
    ) {
      return activate(account, minutes, rpId, pageOrigin, fullOwner, (context) =>
        unlockRoutineMaterial(
          () =>
            ports.unlock(
              {
                address: context.account,
                networkId: context.networkId,
                bindingId: context.bindingId,
                credentialId: Uint8Array.from(context.credentialId),
              },
              rpId,
            ),
          fullOwner,
        ),
      );
    },
    prepareLogin: () =>
      prepareRoutineLogin({
        lock: () => lock(),
        revision: () => revision,
        activate: (account, minutes, rpId, origin, load) =>
          activate(account, minutes, rpId, origin, false, load),
      }),
    credentialScope(account: RoutineAccount) {
      const context = contextOf(account);
      return context && matches(context) ? credentialScope : undefined;
    },
    ownerSession(account: RoutineAccount) {
      const context = contextOf(account);
      return context && matches(context) ? owner : undefined;
    },
    verifyOwner(account: RoutineAccount) {
      const context = contextOf(account);
      if (!context || !matches(context) || !owner)
        throw new Error('Authenticated owner is locked.');
      publish({ ...state, ownerVerified: true });
    },
    viewer(request: RoutineContext): Pick<AccountViewingKey, 'openInbox'> | undefined {
      const context = Object.freeze({ ...request, credentialId: request.credentialId.slice() });
      if (!matches(context)) return undefined;
      const version = revision;
      return createRoutineReader(
        context,
        () => check(context, version),
        () => reader!.slice(),
      );
    },
    walletSeed(account: RoutineAccount): Uint8Array | undefined {
      const context = contextOf(account);
      return context && matches(context) ? seed!.slice() : undefined;
    },
    async sessionKey(account: RoutineAccount, request: SessionKeyContext) {
      const context = Object.freeze({ ...request });
      const pinned = contextOf(account);
      if (!pinned || !matches(pinned)) return undefined;
      const version = revision;
      if (
        context.account !== pinned.account ||
        context.networkId !== pinned.networkId ||
        context.bindingId !== pinned.bindingId ||
        context.origin !== origin
      )
        throw new Error('Session signer context mismatch.');
      const key = await createSessionJubjubAuthoriser(source, await ports.pure(), context, now);
      try {
        check(pinned, version);
        children.add(key);
        publish({ ...state, publicKey: owner?.publicKey ?? key.publicKey });
        return {
          publicKey: key.publicKey,
          dispose: key.dispose,
          authoriser: {
            ...key.authoriser,
            async devicePublicKey() {
              check(pinned, version);
              return key.authoriser.devicePublicKey();
            },
            async devicePublicKeyHex() {
              check(pinned, version);
              return key.authoriser.devicePublicKeyHex!();
            },
            async withKeySession(work, flow) {
              check(pinned, version);
              // Do not hide a confirmed transaction because local expiry raced settlement.
              return key.authoriser.withKeySession!(work, flow);
            },
            async authorise(operation) {
              check(pinned, version);
              const signed = await key.authoriser.authorise(operation);
              check(pinned, version);
              return signed;
            },
          },
        } satisfies {
          publicKey: string;
          dispose(): void;
          authoriser: import('@input-output-hk/mn-passport-account/ports').Authoriser;
        };
      } catch (error) {
        key.dispose();
        throw error;
      }
    },
  };
}
