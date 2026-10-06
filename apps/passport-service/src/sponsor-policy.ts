import { HttpError } from './http.ts';

/**
 * The sponsor pays Dust fees for one kind of transaction: calls to Passport accounts this service
 * deployed, and nothing but calls. This file decides that, purely, over a structural view of the
 * ledger transaction, so the rule is testable without the ledger's wasm.
 *
 * Why calls only (Ruling R17): the wallet signs without checking owners. `signRecipe` on an
 * unbound recipe signs every intent segment, and wallet-sdk-unshielded-wallet's
 * `addSignaturesToOffer` (v2 TransactionOps) puts the sponsor's signature on every input of the
 * guaranteed and fallible unshielded offers, whoever owns it; a Dust registration shares the same
 * signed segment data. A net-zero imbalance check alone would let a client spend the sponsor's
 * NIGHT (an input of the sponsor's, an output to the client) or redirect its Dust generation.
 * So a sponsored transaction carries no unshielded offer, no Dust action and no shielded offer.
 */

export type ActionKind = 'call' | 'deploy' | 'maintenance' | 'other';

export interface ActionView {
  readonly kind: ActionKind;
  /** The called contract's address (hex), for a call. */
  readonly address?: string;
}

export interface IntentView {
  readonly actions: readonly ActionView[];
  /** Present when the intent carries an unshielded offer in that section, whatever is in it. */
  readonly guaranteedUnshieldedOffer?: unknown;
  readonly fallibleUnshieldedOffer?: unknown;
  /** Present when the intent carries any Dust spend or registration. */
  readonly dustActions?: unknown;
}

export interface SponsorTxView {
  /** Present on a rewards-claim transaction. */
  readonly rewards?: unknown;
  readonly intents?: ReadonlyMap<number, IntentView>;
  /** Present when the transaction carries a shielded (Zswap) offer in that section. */
  readonly guaranteedOffer?: unknown;
  readonly fallibleOffer?: unknown;
  /** Segment 0 (the guaranteed section) plus every intent and fallible-offer segment. */
  readonly segments: readonly number[];
  /** What the transaction leaves unpaid, or over-pays, per token type, in a segment. */
  imbalances(segment: number): ReadonlyMap<{ readonly tag: string }, bigint>;
}

/**
 * Returns why a transaction must not be sponsored, or `undefined` when it may be. `allowed` holds
 * lowercase hex addresses; call addresses are lowercased before they are looked up.
 */
export function sponsorPolicy(
  view: SponsorTxView,
  allowed: ReadonlySet<string>,
): string | undefined {
  if (view.rewards !== undefined) return 'rewards transactions are not sponsored';
  const intents = view.intents;
  if (intents === undefined || intents.size === 0) return 'the transaction has no intents';
  if (view.guaranteedOffer !== undefined || view.fallibleOffer !== undefined) {
    return 'transactions with shielded offers are not sponsored';
  }
  for (const intent of intents.values()) {
    if (
      intent.guaranteedUnshieldedOffer !== undefined ||
      intent.fallibleUnshieldedOffer !== undefined
    ) {
      return 'transactions with unshielded offers are not sponsored';
    }
    if (intent.dustActions !== undefined) return 'transactions with Dust actions are not sponsored';
  }
  let calls = 0;
  for (const intent of intents.values()) {
    for (const action of intent.actions) {
      if (action.kind !== 'call') return `${action.kind} actions are not sponsored`;
      const address = action.address?.toLowerCase();
      if (address === undefined || !allowed.has(address)) {
        return 'the call is not to a Passport account deployed by this service';
      }
      calls++;
    }
  }
  if (calls === 0) return 'the transaction has no contract calls';
  for (const segment of view.segments) {
    let imbalances: ReadonlyMap<{ readonly tag: string }, bigint>;
    try {
      imbalances = view.imbalances(segment);
    } catch {
      return `the imbalances of segment ${segment} cannot be computed`;
    }
    for (const [token, value] of imbalances) {
      // Dust is the fee the sponsor adds; anything else would be paid out of its pocket.
      if (token.tag !== 'dust' && value !== 0n) {
        return `the transaction moves ${token.tag} value in segment ${segment}; only fees are sponsored`;
      }
    }
  }
  return undefined;
}

/** The members of a ledger transaction this file reads (midnightntwrk/ledger-v9). */
export interface LedgerIntentLike {
  readonly actions: readonly unknown[];
  readonly guaranteedUnshieldedOffer: unknown;
  readonly fallibleUnshieldedOffer: unknown;
  readonly dustActions:
    { readonly spends: readonly unknown[]; readonly registrations: readonly unknown[] } | undefined;
}

export interface LedgerTxLike {
  readonly rewards: unknown;
  readonly intents: ReadonlyMap<number, LedgerIntentLike> | undefined;
  readonly guaranteedOffer: unknown;
  readonly fallibleOffer: ReadonlyMap<number, unknown> | undefined;
  imbalances(segment: number): ReadonlyMap<{ readonly tag: string }, bigint>;
}

type Ctor = abstract new (...args: never[]) => unknown;

/** The ledger's action classes, from the same module instance that produced the transaction. */
export interface ActionClasses {
  readonly ContractCall: Ctor;
  readonly ContractDeploy: Ctor;
  readonly MaintenanceUpdate: Ctor;
}

function actionView(action: unknown, classes: ActionClasses): ActionView {
  // `instanceof` first; the structural check covers a copy of the module loaded twice.
  const isCall =
    action instanceof classes.ContractCall ||
    (typeof action === 'object' && action !== null && 'entryPoint' in action);
  if (isCall) {
    const address = (action as { address?: unknown }).address;
    return typeof address === 'string' ? { kind: 'call', address } : { kind: 'call' };
  }
  if (action instanceof classes.ContractDeploy) return { kind: 'deploy' };
  if (action instanceof classes.MaintenanceUpdate) return { kind: 'maintenance' };
  return { kind: 'other' };
}

const present = (v: unknown): boolean => v !== undefined && v !== null;

function intentView(intent: LedgerIntentLike, classes: ActionClasses): IntentView {
  const dust = intent.dustActions;
  const hasDust = present(dust) && (dust!.spends.length > 0 || dust!.registrations.length > 0);
  return {
    actions: intent.actions.map((a) => actionView(a, classes)),
    ...(present(intent.guaranteedUnshieldedOffer)
      ? { guaranteedUnshieldedOffer: intent.guaranteedUnshieldedOffer }
      : {}),
    ...(present(intent.fallibleUnshieldedOffer)
      ? { fallibleUnshieldedOffer: intent.fallibleUnshieldedOffer }
      : {}),
    ...(hasDust ? { dustActions: dust } : {}),
  };
}

/** A thin adapter from a deserialised ledger transaction to the view `sponsorPolicy` reads. */
export function viewOfLedgerTx(tx: LedgerTxLike, classes: ActionClasses): SponsorTxView {
  const intents = tx.intents;
  const fallible = tx.fallibleOffer;
  const segments = new Set<number>([0, ...(intents?.keys() ?? []), ...(fallible?.keys() ?? [])]);
  return {
    rewards: tx.rewards,
    ...(intents === undefined
      ? {}
      : {
          intents: new Map(
            [...intents].map(([segment, intent]) => [segment, intentView(intent, classes)]),
          ),
        }),
    ...(present(tx.guaranteedOffer) ? { guaranteedOffer: tx.guaranteedOffer } : {}),
    // An empty map holds no offer.
    ...(fallible !== undefined && fallible.size > 0 ? { fallibleOffer: fallible } : {}),
    segments: [...segments],
    imbalances: (segment) => tx.imbalances(segment),
  };
}

export interface GuardedBalanceDeps {
  /** Deserialises an unbound transaction; throws when the bytes are not one. */
  deserialize(bytes: Uint8Array): LedgerTxLike;
  readonly classes: ActionClasses;
  /** The addresses the sponsor funds calls to, read afresh for each request. */
  allowed(): ReadonlySet<string>;
  /** The wallet's balancing; reached only for a transaction the policy accepts. */
  balance(bytes: Uint8Array): Promise<Uint8Array>;
}

/** Wraps the wallet's balancing in the policy: HttpError 400 for bad bytes, 403 for a refusal. */
export function guardedBalance(deps: GuardedBalanceDeps): (tx: Uint8Array) => Promise<Uint8Array> {
  return async (tx) => {
    let parsed: LedgerTxLike;
    try {
      parsed = deps.deserialize(tx);
    } catch {
      throw new HttpError(400, 'tx is not a serialised, proven, unbound transaction');
    }
    const refusal = sponsorPolicy(viewOfLedgerTx(parsed, deps.classes), deps.allowed());
    if (refusal !== undefined) throw new HttpError(403, refusal);
    return deps.balance(tx);
  };
}
