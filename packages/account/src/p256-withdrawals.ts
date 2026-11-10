import type { P256AccountContext, P256MethodArgs } from './p256-account-context.js';
import type { P256Hint } from './p256-device.js';
import { prepareShieldedWithdrawal, prepareUnshieldedWithdrawal } from './unshielded-withdrawal.js';
import { PassportConnectorError } from './errors.js';
import { fromHex, toHex } from './codec.js';
import { p256, isSealedP256 } from './p256-device.js';
import { readQualifiedHolding } from './holdings.js';
import type { QualifiedHoldingSource } from './ports/index.js';
import {
  equalBytes,
  deviceBinding,
  inboxView,
  withdrawChallenge,
  shieldedChallenge,
} from './p256-operation-guards.js';
export class P256Withdrawals {
  constructor(
    private readonly host: P256AccountContext,
    private readonly record: P256Hint,
  ) {}
  withdrawUnshielded = (
    request: P256MethodArgs<'withdrawUnshielded'>[0],
    options: P256MethodArgs<'withdrawUnshielded'>[1] = {},
  ) => {
    const { network, binding, authoriser, useCounter, chain, run } = this.host;
    const record = this.record;
    return run(options, async (flow) => {
      const transfer = prepareUnshieldedWithdrawal(request);
      const pure = (await binding()).pureCircuits;
      if (
        network.bindingId !== 'acc-s3r1.1' ||
        !pure.challenge_withdraw_unshielded_with_p256 ||
        !authoriser.withKeySession ||
        !authoriser.deviceBinding
      )
        throw new PassportConnectorError(
          'BindingUnsupported',
          'P-256 withdrawal needs the pinned challenge, key session and device binding.',
        );
      if (record.status !== 'active')
        throw new PassportConnectorError('AccountNotFound', 'The P-256 ACC is not active.');
      return authoriser.withKeySession(
        async () => {
          const selected = await authoriser.devicePublicKey();
          const selectedBinding = await deviceBinding(authoriser);
          if (
            selected.x !== record.publicKey.x ||
            selected.y !== record.publicKey.y ||
            !equalBytes(selectedBinding.credentialId, record.credentialId) ||
            !equalBytes(selectedBinding.policy.rp_id_hash, record.policy.rp_id_hash) ||
            !equalBytes(selectedBinding.policy.origin, record.policy.origin)
          )
            throw new PassportConnectorError(
              'NotAuthorised',
              'The selected passkey does not own this ACC.',
            );
          const { counter, authNonce } = await useCounter(flow, record);
          const circuit = 'withdraw_unshielded_with_p256';
          const challenge = withdrawChallenge(
            pure,
            { bytes: fromHex(record.address) },
            p256(record.publicKey),
            transfer.color,
            transfer.amount,
            transfer.recipient,
            authNonce,
          );
          const signed = await flow.step('passkey.sign', () =>
            authoriser.authorise({
              account: record.address,
              circuit,
              args: [transfer.color, transfer.amount, transfer.recipient],
              witnessValues: [],
              authNonce,
              useCounter: counter,
              challenge,
              credentialId: record.credentialId,
            }),
          );
          if (
            signed.scheme !== 'p256-webauthn' ||
            signed.useCounter !== counter ||
            signed.pk.x !== record.publicKey.x ||
            signed.pk.y !== record.publicKey.y
          )
            throw new PassportConnectorError(
              'NotAuthorised',
              'The signature names another device.',
            );
          flow.checkpoint();
          const tx = await (
            await chain()
          ).call({
            address: record.address,
            circuit,
            args: [
              transfer.color,
              transfer.amount,
              transfer.recipient,
              {
                pk: p256(record.publicKey),
                use_counter: counter,
                policy: record.policy,
                authenticator_data: signed.authenticatorData,
                sig: signed.sig,
              },
            ],
            ...flow.ports,
          });
          return { ...tx, nextUseCounter: counter + 1n };
        },
        {
          kind: 'withdraw-unshielded',
          account: record.address,
          color: toHex(transfer.color),
          amount: transfer.amount.toString(),
          recipient: toHex(transfer.recipient.bytes),
        },
      );
    });
  };
  withdrawShielded = (
    request: P256MethodArgs<'withdrawShielded'>[0],
    options: P256MethodArgs<'withdrawShielded'>[1] = {},
  ) => {
    const {
      ports,
      network,
      networkId,
      binding,
      viewingKey,
      authoriser,
      chain,
      readView,
      findCounter,
      notHeld,
      sealedKeyring,
      run,
    } = this.host;
    const record = this.record;
    return run(options, async (flow) => {
      const transfer = prepareShieldedWithdrawal(request);
      const qualified = ports.holdings as QualifiedHoldingSource | undefined;
      const pure = (await binding()).pureCircuits;
      if (
        network.bindingId !== 'acc-s3r1.1' ||
        !pure.challenge_withdraw_shielded_with_p256 ||
        !isSealedP256(record) ||
        !viewingKey ||
        !qualified?.selectQualifiedHeldCoins ||
        !authoriser.withKeySession ||
        !authoriser.deviceBinding
      )
        throw new PassportConnectorError(
          'BindingUnsupported',
          'P-256 shielded withdrawal needs sealed keys, qualified holdings and a key session.',
        );
      if (record.status !== 'active')
        throw new PassportConnectorError('AccountNotFound', 'The P-256 ACC is not active.');
      return authoriser.withKeySession(
        async () => {
          const selected = await authoriser.devicePublicKey();
          const selectedBinding = await deviceBinding(authoriser);
          if (
            selected.x !== record.publicKey.x ||
            selected.y !== record.publicKey.y ||
            !equalBytes(selectedBinding.credentialId, record.credentialId) ||
            !equalBytes(selectedBinding.policy.rp_id_hash, record.policy.rp_id_hash) ||
            !equalBytes(selectedBinding.policy.origin, record.policy.origin)
          )
            throw new PassportConnectorError(
              'NotAuthorised',
              'The selected passkey does not own this ACC.',
            );
          const view = await readView(flow, record);
          if (!view.booted || view.specVersion !== 3)
            throw new PassportConnectorError('AccountNotFound', 'The P-256 ACC is not active.');
          const counter = await findCounter(flow, record, view);
          if (counter === undefined) throw notHeld(record);
          await sealedKeyring(record, view, false, true);
          const chainPort = await chain();
          const coin = await readQualifiedHolding(
            {
              account: record.address,
              keyring: {
                account: record.address,
                encKey: inboxView(view).encKey,
                envelopes: [...inboxView(view).inboxEntries].reverse(),
              },
              inboxIndex: transfer.inboxIndex,
              color: transfer.color,
            },
            { networkId, chain: chainPort, viewingKey, holdings: qualified },
          );
          if (transfer.amount !== coin.value)
            throw new PassportConnectorError(
              'TransferInvalid',
              'A shielded owner withdrawal must spend the selected coin exactly until change settlement is available.',
            );
          const circuit = 'withdraw_shielded_with_p256';
          const challenge = shieldedChallenge(
            pure,
            { bytes: fromHex(record.address) },
            p256(record.publicKey),
            transfer.recipient,
            transfer.color,
            transfer.amount,
            coin,
            view.authNonce,
          );
          const signed = await flow.step('passkey.sign', () =>
            authoriser.authorise({
              account: record.address,
              circuit,
              args: [transfer.recipient, transfer.color, transfer.amount],
              witnessValues: [coin],
              authNonce: view.authNonce,
              useCounter: counter,
              challenge,
              credentialId: record.credentialId,
            }),
          );
          if (
            signed.scheme !== 'p256-webauthn' ||
            signed.useCounter !== counter ||
            signed.pk.x !== record.publicKey.x ||
            signed.pk.y !== record.publicKey.y
          )
            throw new PassportConnectorError(
              'NotAuthorised',
              'The signature names another device.',
            );
          flow.checkpoint();
          const tx = await chainPort.call({
            address: record.address,
            circuit,
            args: [
              transfer.recipient,
              transfer.color,
              transfer.amount,
              {
                pk: p256(record.publicKey),
                use_counter: counter,
                policy: record.policy,
                authenticator_data: signed.authenticatorData,
                sig: signed.sig,
              },
            ],
            heldCoin: coin,
            ...flow.ports,
          });
          return { ...tx, nextUseCounter: counter + 1n };
        },
        {
          kind: 'withdraw-shielded',
          account: record.address,
          color: toHex(transfer.color),
          amount: transfer.amount.toString(),
          recipient: toHex(transfer.recipient.bytes),
          inboxIndex: transfer.inboxIndex,
        },
      );
    });
  };
}
