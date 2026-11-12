import type { P256UnshieldedGrantScope } from '@input-output-hk/mn-passport-account/ports';
import { z } from 'zod';
import {
  chainReference,
  decodeGrantJson,
  grantWireHex32,
  grantWireUint128,
  invalidBrowserGrant,
  maxGrantParameterLength,
  timestamp,
} from './browser-grant-wire.js';
import { base64url } from './webauthn.js';

const scopeSchema = z.strictObject({
  op_withdraw_unshielded: z.literal(true),
  op_withdraw_shielded: z.literal(false),
  op_withdraw_shielded_to_contract: z.literal(false),
  read: z.literal(false),
  color: grantWireHex32,
  recipient_kind: z.literal(1),
  recipient: grantWireHex32,
  max_coin_value: grantWireUint128,
  per_call_cap: grantWireUint128,
  cap: grantWireUint128,
  expires_at: timestamp.min(1),
});
const callbackSchema = z.strictObject({
  state: z.string().min(22).max(512),
  iss: z.string().max(256),
  result: z.literal('granted'),
  chain: chainReference.refine((value) => value.startsWith('midnight:')),
  account: grantWireHex32,
  grant_id: grantWireHex32,
  scope_salt: grantWireHex32,
  scope: z.string().max(maxGrantParameterLength),
});
const incomingCallbackSchema = callbackSchema.extend({ tx: z.string().min(1).max(256).optional() });

export function browserP256CallbackScope(scope: P256UnshieldedGrantScope) {
  return scopeSchema.parse({
    op_withdraw_unshielded: true,
    op_withdraw_shielded: false,
    op_withdraw_shielded_to_contract: false,
    read: false,
    color: scope.color,
    recipient_kind: 1,
    recipient: scope.recipient,
    max_coin_value: scope.maxCoinValue,
    per_call_cap: scope.perCallCap,
    cap: scope.cap,
    expires_at: scope.expiresAt,
  });
}

export function encodeBrowserP256CallbackFragment(input: {
  readonly state: string;
  readonly issuer: string;
  readonly networkId: string;
  readonly grantId: string;
  readonly scopeSalt: string;
  readonly scope: P256UnshieldedGrantScope;
}): string {
  const scope = browserP256CallbackScope(input.scope);
  const fields = callbackSchema.parse({
    state: input.state,
    iss: input.issuer,
    result: 'granted',
    chain: 'midnight:' + input.networkId.replace(/^midnight:/, ''),
    account: input.scope.account,
    grant_id: input.grantId,
    scope_salt: input.scopeSalt,
    scope: base64url(new TextEncoder().encode(JSON.stringify(scope))),
  });
  return '#' + new URLSearchParams(Object.entries(fields)).toString();
}

export function decodeBrowserP256CallbackFragment(fragment: string) {
  try {
    if (!fragment.startsWith('#') || fragment.length > maxGrantParameterLength * 2)
      return invalidBrowserGrant();
    const fields = new Map<string, string>();
    new URLSearchParams(fragment.slice(1)).forEach((value, key) => {
      if (fields.has(key)) return invalidBrowserGrant();
      fields.set(key, value);
    });
    const { scope, ...callback } = incomingCallbackSchema.parse(Object.fromEntries(fields));
    return { ...callback, scope: scopeSchema.parse(decodeGrantJson(scope)) };
  } catch {
    return invalidBrowserGrant();
  }
}
