import { PassportConnectorError } from '@input-output-hk/mn-passport-account';
import {
  AccountContextSchema,
  UnshieldedWithdrawalSchema,
} from '@input-output-hk/mn-passport-account/validation';
import type { CallRequest } from '@input-output-hk/mn-passport-account/ports';
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import { NIGHT_SEND_OPERATIONS, type NightSendIntent } from './midnames/night-send.js';
import { withdrawalRequest } from './withdrawal.js';

interface ReviewContext {
  readonly account: string;
  readonly networkId: string;
  readonly bindingId: string;
  readonly route: 'primary' | 'authenticated-owner';
  readonly scheme: 'p256-webauthn' | 'jubjub-schnorr';
}
export type NamedNightReview = Pick<
  NightSendIntent,
  | 'requestId'
  | 'name'
  | 'networkId'
  | 'source'
  | 'bridge'
  | 'asset'
  | 'amount'
  | 'target'
  | 'providerId'
  | 'namespace'
  | 'operations'
>;
export type ExactReview = ReviewContext &
  (
    | {
        readonly kind: 'withdraw';
        readonly color: string;
        readonly amount: string;
        readonly recipient: string;
        readonly recipientAddress: string;
        readonly balance: string;
        readonly outsideSession: boolean;
        readonly namedNight?: NamedNightReview;
      }
    | { readonly kind: 'exportGrant'; readonly grantId: string }
  );

export function refuseExactReview(): never {
  throw new PassportConnectorError('UserCancelled', 'The exact operation approval is unavailable.');
}

export function exactOwnerScheme(scheme: PassportAccount['scheme']) {
  if (scheme === 'p256-webauthn' || scheme === 'jubjub-schnorr') return scheme;
  return refuseExactReview();
}

function admitNamedNight(
  named: NamedNightReview,
  context: ReviewContext,
  transfer: { readonly color: string; readonly amount: string; readonly recipient: string },
  outsideSession: boolean,
): NamedNightReview {
  if (
    context.networkId !== 'undeployed' ||
    context.bindingId !== 'acc-s3r1.1' ||
    context.scheme !== 'jubjub-schnorr' ||
    transfer.color !== '00'.repeat(32) ||
    outsideSession
  )
    return refuseExactReview();
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(named.requestId) ||
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?\.)+night$/.test(named.name) ||
    named.name.length > 256 ||
    !/^[a-f0-9]{64}$/.test(named.target) ||
    named.target === context.account ||
    !/^midnames:[a-f0-9]{64}$/.test(named.providerId) ||
    named.namespace !== 'night'
  )
    return refuseExactReview();
  if (
    named.networkId !== context.networkId ||
    named.source !== context.account ||
    named.bridge !== transfer.recipient ||
    named.asset !== 'NIGHT' ||
    named.amount !== transfer.amount ||
    !Array.isArray(named.operations) ||
    named.operations.length !== NIGHT_SEND_OPERATIONS.length ||
    named.operations.some((operation, index) => operation !== NIGHT_SEND_OPERATIONS[index])
  )
    return refuseExactReview();
  return Object.freeze({
    requestId: named.requestId,
    name: named.name,
    networkId: named.networkId,
    source: named.source,
    bridge: named.bridge,
    asset: named.asset,
    amount: named.amount,
    target: named.target,
    providerId: named.providerId,
    namespace: named.namespace,
    operations: NIGHT_SEND_OPERATIONS,
  });
}

/** Owned public intent only. Neither this model nor its presence grants authority. */
export function admitExactReview(input: ExactReview): ExactReview {
  const context = AccountContextSchema.parse(input);
  if (
    !['primary', 'authenticated-owner'].includes(input.route) ||
    !['p256-webauthn', 'jubjub-schnorr'].includes(input.scheme) ||
    (input.route === 'authenticated-owner' && input.scheme !== 'jubjub-schnorr')
  )
    return refuseExactReview();
  const shared = { ...context, route: input.route, scheme: input.scheme };
  if (input.kind === 'exportGrant') {
    if (typeof input.grantId !== 'string' || !/^[0-9a-f]{64}$/.test(input.grantId))
      return refuseExactReview();
    return Object.freeze({
      ...shared,
      kind: 'exportGrant',
      grantId: input.grantId,
    });
  }
  if (
    input.kind !== 'withdraw' ||
    typeof input.balance !== 'string' ||
    input.balance.length > 39 ||
    !/^(?:0|[1-9][0-9]*)$/.test(input.balance) ||
    typeof input.recipientAddress !== 'string' ||
    input.recipientAddress.length > 256 ||
    typeof input.outsideSession !== 'boolean'
  )
    return refuseExactReview();
  const transfer = UnshieldedWithdrawalSchema.parse(input);
  const address = input.recipientAddress.trim();
  const decoded = withdrawalRequest(
    context.networkId,
    transfer.color,
    transfer.amount,
    address,
    input.balance,
  );
  if (decoded.recipient !== transfer.recipient) return refuseExactReview();
  const namedNight =
    input.namedNight && admitNamedNight(input.namedNight, shared, transfer, input.outsideSession);
  return Object.freeze({
    ...shared,
    ...transfer,
    kind: 'withdraw',
    recipientAddress: address,
    balance: input.balance,
    outsideSession: input.outsideSession,
    ...(namedNight && { namedNight }),
  });
}

export function exactReviewText(intent: ExactReview): string {
  const context = `Network: ${intent.networkId}\nBinding: ${intent.bindingId}\nACC: ${intent.account}`;
  const route =
    intent.route === 'authenticated-owner'
      ? 'JubJub owner after fresh passkey approval'
      : `${intent.scheme === 'p256-webauthn' ? 'P-256' : 'JubJub'} owner`;
  if (intent.kind === 'exportGrant')
    return `Export grant details?\n\n${context}\nGrant: ${intent.grantId}\nAuthorization: ${route}\n\nShare these details only with the named holder.`;
  return (
    `Withdraw from Passport account?\n\n${context}\nAuthorization: ${route}\n` +
    `Asset: ${intent.color}\nAmount: ${intent.amount} smallest units\n` +
    `Recipient: ${intent.recipientAddress}\nRecipient bytes: ${intent.recipient}\n` +
    `Observed balance: ${intent.balance} smallest units` +
    (intent.namedNight
      ? `\n\nNamed NIGHT payment: ${intent.namedNight.name}\n` +
        `Registry: ${intent.namedNight.providerId.slice('midnames:'.length)}\n` +
        `Recipient Passport ACC: ${intent.namedNight.target}\n` +
        `Operations: ${intent.namedNight.operations.join(' → ')}\n` +
        `Request: ${intent.namedNight.requestId}\n` +
        'The ACC signs the withdrawal to the bridge. This app checks the name and recipient ACC before dispatch.'
      : '') +
    (intent.outsideSession
      ? '\nThis transfer is outside the selected session; owner approval is required.'
      : '')
  );
}

/** Decode only the owner-transfer prefix, before the reviewed value route can send it. */
export function withdrawalFromCall(request: CallRequest) {
  if (
    !['withdraw_unshielded_with_p256', 'withdraw_unshielded_with_jubjub'].includes(request.circuit)
  )
    return refuseExactReview();
  const [color, amount, recipient] = request.args;
  if (
    !(color instanceof Uint8Array) ||
    color.length !== 32 ||
    typeof amount !== 'bigint' ||
    !recipient ||
    typeof recipient !== 'object' ||
    !('bytes' in recipient) ||
    !(recipient.bytes instanceof Uint8Array) ||
    recipient.bytes.length !== 32
  )
    return refuseExactReview();
  const hex = (bytes: Uint8Array) =>
    Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return {
    account: request.address,
    scheme:
      request.circuit === 'withdraw_unshielded_with_p256'
        ? ('p256-webauthn' as const)
        : ('jubjub-schnorr' as const),
    ...UnshieldedWithdrawalSchema.parse({
      color: hex(color),
      amount: amount.toString(),
      recipient: hex(recipient.bytes),
    }),
  };
}
