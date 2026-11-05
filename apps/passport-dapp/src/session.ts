import type { Authoriser } from '@input-output-hk/mn-passport-account/ports';
import type {
  GrantScopeInput,
  PassportAccount,
  FlowOptions,
  PassportUnshieldedWithdrawal,
} from '@input-output-hk/mn-passport-protocol';
import type { SessionKeyContext } from '@input-output-hk/mn-passport-keys';
import type { GrantHandoff } from './grant-handoff.js';

export interface DemoSessionKey {
  readonly publicKey: string;
  readonly authoriser: Authoriser;
  dispose(): void;
}
export interface DemoSessionSnapshot {
  readonly status:
    | 'locked'
    | 'authorizing'
    | 'active'
    | 'spending'
    | 'revoking'
    | 'expired'
    | 'blocked'
    | 'revoked';
  readonly account?: string;
  readonly grantId?: string;
  readonly expiresAt?: number;
  readonly color?: string;
  readonly recipient?: string;
  readonly perCallCap?: string;
  readonly cap?: string;
  readonly spent: string;
  readonly txHash?: string;
  readonly intentId?: string;
}
export interface DemoSessionPorts {
  readonly now?: () => number;
  readonly monotonic?: () => number;
  readonly unlock: (
    account: PassportAccount,
    context: SessionKeyContext,
  ) => Promise<DemoSessionKey>;
  readonly opening: (account: string, grantId: string) => Promise<GrantHandoff>;
  readonly spend: (
    opening: GrantHandoff,
    key: Authoriser,
    amount: string,
    spent: string,
    signal: AbortSignal,
  ) => Promise<{ txHash: string; spentTotal: bigint }>;
  readonly changed: (snapshot: DemoSessionSnapshot) => void;
  /** Public metadata only, to retain grant IDs and uncertainty fences across page reloads. */
  readonly checkpoint?: {
    read(): DemoSessionSnapshot | undefined;
    write(snapshot: DemoSessionSnapshot): void;
    begin(snapshot: DemoSessionSnapshot): void;
    settle(snapshot: DemoSessionSnapshot): void;
  };
}

/** One page, one delegated grant. No persisted secrets, silent renewals or uncertain-spend retries. */
export function createDemoSession(ports: DemoSessionPorts) {
  const now = ports.now ?? Date.now;
  const monotonic = ports.monotonic ?? (() => performance.now());
  const retained = ports.checkpoint?.read();
  let state: DemoSessionSnapshot = retained
    ? Object.freeze({
        ...retained,
        status: ['authorizing', 'spending', 'revoking', 'blocked'].includes(retained.status)
          ? 'blocked'
          : retained.status === 'revoked'
            ? 'revoked'
            : 'locked',
      })
    : { status: 'locked', spent: '0' };
  let key: DemoSessionKey | undefined;
  let opening: GrantHandoff | undefined;
  let revision = 0;
  let busy = false;
  let deadline = 0;
  let lastWall = 0;
  let lastMono = 0;
  let cancellation = new AbortController();
  const submittedIds = (error: unknown) => {
    if (!error || typeof error !== 'object') return {};
    const value = error as { grantId?: unknown; txHash?: unknown };
    return {
      ...(typeof value.grantId === 'string' &&
        /^[0-9a-f]{64}$/.test(value.grantId) && { grantId: value.grantId }),
      ...(typeof value.txHash === 'string' &&
        /^[0-9a-f]{64}(?:[0-9a-f]{2})?$/i.test(value.txHash) && {
          txHash: value.txHash.toLowerCase(),
        }),
    };
  };
  const publish = (patch: Partial<DemoSessionSnapshot>) => {
    state = Object.freeze({ ...state, ...patch });
    ports.checkpoint?.write(state);
    ports.changed(state);
  };
  const dispose = () => {
    key?.dispose();
    key = undefined;
    cancellation.abort();
  };
  const uncertain = (value: DemoSessionSnapshot) =>
    ['authorizing', 'spending', 'revoking', 'blocked'].includes(value.status);
  const sync = () => {
    const saved = ports.checkpoint?.read();
    if (!saved) return;
    if (busy) {
      if (saved.intentId !== state.intentId) {
        revision++;
        dispose();
        state = Object.freeze({ ...state, status: 'blocked' });
        ports.checkpoint?.write(state);
        ports.changed(state);
      }
      return;
    }
    const foreign = saved.intentId !== state.intentId;
    if (
      (uncertain(saved) && (foreign || state.status !== 'blocked')) ||
      (!uncertain(saved) && (foreign || state.status === 'blocked'))
    ) {
      revision++;
      dispose();
      state = Object.freeze({
        ...saved,
        status: uncertain(saved) ? 'blocked' : saved.status === 'revoked' ? 'revoked' : 'locked',
      });
      ports.changed(state);
    }
  };
  const begin = (patch: Partial<DemoSessionSnapshot>) => {
    state = Object.freeze({ ...state, ...patch, intentId: crypto.randomUUID() });
    ports.checkpoint?.begin(state);
    ports.changed(state);
  };
  const settle = (next: DemoSessionSnapshot) => {
    state = Object.freeze(next);
    ports.checkpoint?.settle(state);
    ports.changed(state);
  };
  const lock = () => {
    sync();
    const owned = !!key || busy;
    revision++;
    dispose();
    if (state.status !== 'revoked')
      if (owned) publish({ status: uncertain(state) ? 'blocked' : 'locked' });
      else {
        state = Object.freeze({ ...state, status: uncertain(state) ? 'blocked' : 'locked' });
        ports.changed(state);
      }
  };
  const tick = () => {
    sync();
    if (
      state.status === 'active' ||
      state.status === 'spending' ||
      state.status === 'authorizing'
    ) {
      const wall = now(),
        mono = monotonic();
      if (
        !Number.isFinite(wall) ||
        !Number.isFinite(mono) ||
        wall < lastWall ||
        mono < lastMono ||
        wall >= state.expiresAt! ||
        mono >= deadline
      ) {
        revision++;
        dispose();
        publish({
          status:
            state.status === 'spending' || state.status === 'authorizing' ? 'blocked' : 'expired',
        });
      }
      lastWall = wall;
      lastMono = mono;
    }
    return state;
  };
  const current = (version: number) => {
    tick();
    if (revision !== version || !key || cancellation.signal.aborted)
      throw new Error(
        'The session was locked or expired. Submitted transactions still require reconciliation.',
      );
  };
  ports.changed(state);
  return {
    snapshot: tick,
    lock,
    async start(
      account: PassportAccount,
      scopeInput: Omit<GrantScopeInput, 'grantee' | 'expiresAt'>,
      minutes: number,
      origin: string,
      options: FlowOptions = {},
    ) {
      tick();
      if (busy) throw new Error('A session operation is already running.');
      if (state.grantId || state.status === 'blocked')
        throw new Error(
          'Revoke the previous session grant, or reconcile its original issue before authorizing another.',
        );
      if (!account.issueGrant || !account.credentialId)
        throw new Error('An open passkey-backed account with grant support is required.');
      if (!Number.isInteger(minutes) || minutes < 10 || minutes > 30)
        throw new Error('Choose a session lifetime between 10 and 30 minutes.');
      if (
        scopeInput.operations.length !== 1 ||
        scopeInput.operations[0] !== 'withdraw-unshielded' ||
        scopeInput.read ||
        scopeInput.recipient.kind !== 'user-address' ||
        scopeInput.caller !== undefined
      )
        throw new Error(
          'Demo sessions permit only fixed-recipient unshielded withdrawals without read or caller authority.',
        );
      // Copy all nested user input before any asynchronous consent, key derivation or submission.
      const limits = Object.freeze({
        ...scopeInput,
        operations: ['withdraw-unshielded'] as const,
        recipient: Object.freeze({ ...scopeInput.recipient }),
      });
      const wall = now(),
        mono = monotonic();
      if (!Number.isFinite(wall) || !Number.isFinite(mono))
        throw new Error('Invalid session clock.');
      const expiresAt = Math.floor((wall + minutes * 60_000) / 1000) * 1000;
      deadline = mono + (expiresAt - wall);
      lastWall = wall;
      lastMono = mono;
      const version = ++revision;
      cancellation = new AbortController();
      busy = true;
      let issueAttempted = false;
      try {
        // Do not attribute a prior revocation/transfer hash to a new uncertain issue.
        state = { status: 'locked', spent: '0' };
        opening = undefined;
        begin({
          status: 'authorizing',
          account: account.address,
          expiresAt,
          color: limits.color,
          recipient: limits.recipient.value,
          perCallCap: limits.perCallCap,
          cap: limits.cap,
          spent: '0',
        });
        const candidate = await ports.unlock(account, {
          account: account.address,
          networkId: account.networkId,
          bindingId: account.bindingId,
          origin,
          sessionId: Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
            b.toString(16).padStart(2, '0'),
          ).join(''),
          expiresAt,
        });
        if (revision !== version) {
          candidate.dispose();
          throw new Error('Session authorization was cancelled.');
        }
        key = candidate;
        current(version);
        const scope: GrantScopeInput = {
          ...limits,
          grantee: { scheme: 'jubjub-schnorr', publicKey: key.publicKey },
          expiresAt: expiresAt / 1000,
        };
        issueAttempted = true;
        const issued = await account.issueGrant(scope, { ...options, signal: cancellation.signal });
        publish({ grantId: issued.grantId, txHash: issued.txHash });
        current(version);
        opening = await ports.opening(account.address, issued.grantId);
        current(version);
        if (
          opening.account !== account.address ||
          opening.networkId !== account.networkId ||
          opening.bindingId !== account.bindingId ||
          opening.origin !== origin ||
          opening.grantId !== issued.grantId ||
          opening.granteePublicKey !== key.publicKey ||
          opening.expiresAt !== scope.expiresAt ||
          opening.color !== scope.color ||
          opening.recipient !== limits.recipient.value ||
          opening.perCallCap !== scope.perCallCap ||
          opening.cap !== scope.cap ||
          opening.maxCoinValue !== scope.maxCoinValue
        )
          throw new Error('Confirmed session grant differs from the approved scope.');
        opening = Object.freeze({ ...opening });
        settle({ ...state, status: 'active' });
      } catch (error) {
        dispose();
        if (issueAttempted) publish({ status: 'blocked', ...submittedIds(error) });
        else settle({ ...state, status: 'locked' });
        throw error;
      } finally {
        busy = false;
      }
    },
    matches(account: PassportAccount, transfer: PassportUnshieldedWithdrawal): boolean {
      tick();
      return (
        state.status === 'active' &&
        !!key &&
        !!opening &&
        state.account === account.address &&
        opening.networkId === account.networkId &&
        opening.bindingId === account.bindingId &&
        transfer.color === opening.color &&
        transfer.recipient === opening.recipient &&
        /^[1-9][0-9]*$/.test(transfer.amount) &&
        BigInt(transfer.amount) <= BigInt(opening.perCallCap) &&
        BigInt(transfer.amount) + BigInt(state.spent) <= BigInt(opening.cap)
      );
    },
    async spend(account: PassportAccount, transfer: PassportUnshieldedWithdrawal) {
      if (busy) throw new Error('A session operation is already running.');
      if (!this.matches(account, transfer))
        throw new Error(
          'This transfer is outside the active session scope. Review it with your owner passkey.',
        );
      busy = true;
      const version = revision;
      try {
        const { txHash: _previousHash, ...currentGrant } = state;
        state = currentGrant;
        begin({ status: 'spending' });
        current(version);
        const result = await ports.spend(
          opening!,
          key!.authoriser,
          transfer.amount,
          state.spent,
          cancellation.signal,
        );
        // Capture a confirmed effect even if a local lock/expiry happened while it settled.
        const usable = revision === version && tick().status === 'spending';
        settle({
          ...state,
          spent: result.spentTotal.toString(),
          txHash: result.txHash,
          status: usable ? 'active' : 'locked',
        });
        return result;
      } catch (error) {
        revision++;
        dispose();
        const { txHash } = submittedIds(error);
        publish({ status: 'blocked', ...(txHash && { txHash }) });
        throw error; // No fallback owner send and no automatic retry, including lost responses.
      } finally {
        busy = false;
      }
    },
    async revoke(account: PassportAccount, options: FlowOptions = {}) {
      tick();
      if (busy) throw new Error('A session operation is already running.');
      if (!state.grantId || state.account !== account.address || !account.revokeGrant)
        throw new Error(
          'Open the issuing account and reconcile an unknown issue before revoking its grant.',
        );
      if (state.status === 'blocked')
        throw new Error(
          'Reconcile the original uncertain issue, spend or revocation before revoking through this session control. Use the owner grant roster and operator inspection with the original IDs.',
        );
      lock();
      busy = true;
      try {
        const { txHash: _previousHash, ...grant } = state;
        state = grant;
        begin({ status: 'revoking' });
        const result = await account.revokeGrant(state.grantId!, options);
        const revoked: DemoSessionSnapshot = {
          status: 'revoked',
          spent: state.spent,
          txHash: result.txHash,
          ...(state.intentId && { intentId: state.intentId }),
        };
        opening = undefined;
        settle(revoked);
        return result;
      } catch (error) {
        publish({ status: 'blocked', ...submittedIds(error) });
        throw error;
      } finally {
        busy = false;
      }
    },
  };
}
