import { checkUnshieldedGrant } from '@input-output-hk/mn-passport-account';

/**
 * Prepare one fixed-price payment for merchant.compact, without submitting it.
 * The host must independently trust/pin that contract's code and maintenance
 * policy. A caller address authenticates no particular circuit or browser.
 *
 * @param {import('@input-output-hk/mn-passport-account').UnshieldedGrantIntent} intent
 * @param {{
 *   pure: import('@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1').PureCircuits,
 *   grantee: import('@input-output-hk/mn-passport-account/ports').Authoriser,
 *   read: () => Promise<{
 *     merchant: { address: string, account: string, color: string, recipient: string, price: string },
 *     grant: import('@input-output-hk/mn-passport-account').UnshieldedGrantContext & {
 *       callerCommit: Uint8Array
 *     }
 *   }>,
 *   review: (payment: {
 *     account: string, grantId: string, application: string,
 *     color: string, recipient: string, amount: string
 *   }) => Promise<boolean>,
 *   nowSeconds: () => number,
 *   signal?: { readonly aborted: boolean }
 * }} ports
 */
export async function prepareMerchantPayment(intent, ports) {
  /** @param {string} message @returns {never} */
  const fail = (message) => {
    throw new Error(`merchant-payment: ${message}`);
  };
  const cancelled = () => {
    if (ports.signal?.aborted) fail('cancelled before submission');
  };
  const { grantee, pure } = ports;
  if (grantee.scheme !== 'jubjub-schnorr' || !grantee.withKeySession)
    fail('a JubJub grantee key session is required');
  cancelled();
  intent = { ...intent };
  const initial = await ports.read();
  const snapshot = {
    merchant: { ...initial.merchant },
    grant: {
      ...initial.grant,
      callerCommit: initial.grant.callerCommit.slice(),
      objectCommit: initial.grant.objectCommit.slice(),
      spentCommit: initial.grant.spentCommit.slice(),
    },
  };
  /** @param {Awaited<ReturnType<typeof ports.read>>} current */
  const validate = (current) => {
    const { merchant, grant } = current;
    if (!/^[0-9a-f]{64}$/.test(merchant.address)) fail('invalid merchant address');
    if (
      merchant.account !== intent.account ||
      merchant.color !== intent.color ||
      merchant.recipient !== intent.recipient ||
      merchant.price !== intent.amount
    )
      fail('payment differs from the merchant account, asset, recipient or price');
    const checked = checkUnshieldedGrant(intent, grant, pure, ports.nowSeconds());
    const callerCommit = pure.derive_grant_caller_commit(checked.scopeSalt, {
      is_some: true,
      value: {
        bytes: Uint8Array.from(
          (merchant.address.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16)),
        ),
      },
    });
    if (
      grant.callerCommit.length !== callerCommit.length ||
      !callerCommit.every((byte, index) => byte === grant.callerCommit[index])
    )
      fail('grant is not pinned to this merchant contract');
    return checked;
  };
  const checked = validate(snapshot);
  if (
    !(await ports.review({
      account: intent.account,
      grantId: intent.grantId,
      application: snapshot.merchant.address,
      color: intent.color,
      recipient: intent.recipient,
      amount: intent.amount,
    }))
  )
    fail('payment declined');
  cancelled();
  return grantee.withKeySession(async () => {
    const current = await ports.read();
    const fresh = validate(current);
    if (
      current.merchant.address !== snapshot.merchant.address ||
      fresh.issuedAt !== checked.issuedAt ||
      fresh.nonce !== checked.nonce ||
      current.grant.perCallCap !== snapshot.grant.perCallCap ||
      current.grant.cap !== snapshot.grant.cap ||
      current.grant.expiresAt !== snapshot.grant.expiresAt
    )
      fail('payment context changed after review');
    const selected = await grantee.devicePublicKey();
    if (selected.x !== checked.grantee.x || selected.y !== checked.grantee.y)
      fail('selected key is not the grant holder');
    cancelled();
    const signature = await grantee.authorise({
      account: intent.account,
      circuit: 'withdraw_unshielded_with_grant_jubjub',
      args: [checked.color, checked.amount, { bytes: checked.recipient }],
      witnessValues: [],
      authNonce: 0n,
      useCounter: 0n,
      challenge: (r, grind) =>
        pure.challenge_withdraw_unshielded_with_grant_jubjub(
          { bytes: checked.account },
          r,
          checked.grantee,
          checked.grantId,
          checked.issuedAt,
          checked.color,
          checked.amount,
          { bytes: checked.recipient },
          checked.nonce,
          grind,
        ),
    });
    if (
      signature.scheme !== 'jubjub-schnorr' ||
      signature.pk.x !== checked.grantee.x ||
      signature.pk.y !== checked.grantee.y
    )
      fail('signature names another grant holder');
    cancelled();
    return {
      account: { bytes: checked.account },
      approval: {
        pk: signature.pk,
        origin_hash: checked.originHash,
        slot: checked.slot,
        scope_salt: checked.scopeSalt,
        max_coin_value: checked.maxCoinValue,
        spent_prev: checked.spentPrev,
        sig_r: signature.sigR,
        sig_s: signature.sigS,
        grind_nonce: signature.grindNonce,
      },
    };
  });
}
