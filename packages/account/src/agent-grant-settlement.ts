import { utf8ToBytes } from '@noble/hashes/utils.js';
import type { verifyAgentJubjubGrantRequest } from './agent-grant-request.js';
import type { AgentGrantIssueRecord } from './agent-grant-issue-journal.js';
import { fromHex, toHex } from './codec.js';
import { prepareJubjubGrant, type GrantScopePure } from './grant-scope.js';
import { matchesP256Scope } from './p256-grant-spend-check.js';
import type { P256GrantSpendSource } from './ports/index.js';
import { timestamp } from './grant-request-wire.js';

export type VerifiedAgentGrant = ReturnType<typeof verifyAgentJubjubGrantRequest>;
export interface AgentGrantSettlementPure extends GrantScopePure {
  derive_grant_rp_commit(salt: Uint8Array, rpIdHash: Uint8Array): Uint8Array;
}

export interface GrantedAgentJubjubScope {
  readonly result: 'granted';
  readonly chain: string;
  readonly account: string;
  readonly grant_id: string;
  readonly scope_salt: string;
  readonly scope: string;
}

const web = globalThis as typeof globalThis & { btoa(value: string): string };

export async function settledAgentGrant(
  request: VerifiedAgentGrant,
  record: AgentGrantIssueRecord,
  source: P256GrantSpendSource,
  pure: AgentGrantSettlementPure,
  now: () => number,
): Promise<GrantedAgentJubjubScope | undefined> {
  const prepared = prepareJubjubGrant(
    {
      account: request.account,
      origin: request.clientId,
      scope: request.scope,
      activeGrantIds: [],
      requestedSlot: request.slot,
      nowSeconds: record.admittedAt,
    },
    pure,
    () => fromHex(record.salt),
  );
  // This source exposes the same raw grant ledger fields for either grantee arm.
  const live = await source.readP256GrantSpendContext(request.account, prepared.grantId);
  const current = timestamp.parse(now());
  if (
    !live?.active ||
    current < record.admittedAt ||
    current >= request.scope.expiresAt ||
    live.issuedAt !== record.expectedIssuedAt ||
    live.deviceEpoch !== record.epoch ||
    live.grantEpoch !== record.epoch ||
    live.generation !== record.generation ||
    live.grantGeneration !== record.generation ||
    !matchesP256Scope(live, {
      perCallCap: BigInt(request.scope.perCallCap),
      cap: BigInt(request.scope.cap),
      expiresAt: BigInt(request.scope.expiresAt),
      rpCommit: toHex(pure.derive_grant_rp_commit(prepared.scopeSalt, new Uint8Array(32))),
      objectCommit: toHex(prepared.objectCommit),
    })
  )
    return undefined;
  return {
    result: 'granted',
    chain: 'midnight:' + request.networkId,
    account: request.account,
    grant_id: prepared.grantId,
    scope_salt: record.salt,
    scope: wireScope(request.scope),
  };
}

function wireScope(scope: VerifiedAgentGrant['scope']): string {
  const json = JSON.stringify({
    op_withdraw_unshielded: true,
    op_withdraw_shielded: false,
    op_withdraw_shielded_to_contract: false,
    read: false,
    color: scope.color,
    recipient_kind: 1,
    recipient: scope.recipient.value,
    max_coin_value: scope.maxCoinValue,
    per_call_cap: scope.perCallCap,
    cap: scope.cap,
    expires_at: scope.expiresAt,
  });
  return web
    .btoa(String.fromCharCode(...utf8ToBytes(json)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
