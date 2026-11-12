import type { PassportPartialShieldedWithdrawal } from '@input-output-hk/mn-passport-protocol';
import {
  assertSameOwnerShieldedInput,
  capturePartialShieldedWithdrawal,
  exactOwnerShieldedDispatch,
  existingPartialWithdrawal,
  partialOwnerShieldedDispatch,
  validatePartialWithdrawalHost,
  type PrepareOwnerShieldedDispatch,
} from './partial-shielded-withdrawal.js';
import type { InboxLedgerView } from './inbox-view.js';
/** JubJub owner value flows. Does not select a signer, relax guards or retry a transfer. */
import type { PassportAccount, FlowOptions } from '@input-output-hk/mn-passport-protocol';
import type {
  AccountHint,
  AccLedgerView,
  AccBinding,
  Chain,
  PassportPorts,
  JubjubPureCircuits,
  QualifiedHoldingSource,
} from './ports/index.js';
import type { Flow } from './flow.js';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { prepareShieldedWithdrawal, prepareUnshieldedWithdrawal } from './unshielded-withdrawal.js';
import { readQualifiedHolding } from './holdings.js';
type JubjubHint = AccountHint & {
  readonly scheme: 'jubjub-schnorr';
  readonly credentialId: Uint8Array;
};
const samePoint = (a: { x: bigint; y: bigint }, b: { x: bigint; y: bigint }) =>
  a.x === b.x && a.y === b.y;

type WithdrawalPorts = Pick<
  PassportPorts,
  'authoriser' | 'network' | 'holdings' | 'partialShieldedWithdrawal'
> & {
  viewingKey: NonNullable<PassportPorts['viewingKey']>;
};

type JubjubWithdrawalContext = {
  record: JubjubHint;
  ports: WithdrawalPorts;
  readBinding(): Promise<AccBinding>;
  readChain(): Promise<Chain>;
  requirePure(value: unknown): JubjubPureCircuits;
  read(record: JubjubHint): Promise<InboxLedgerView>;
  findCounter(record: JubjubHint, view: AccLedgerView): bigint | undefined;
  recordPure: WeakMap<JubjubHint, JubjubPureCircuits>;
  run<T>(options: FlowOptions, body: (flow: Flow) => Promise<T>): Promise<T>;
};

function withdrawShieldedUsing<T>(
  context: JubjubWithdrawalContext,
  request: Parameters<NonNullable<PassportAccount['withdrawShielded']>>[0],
  options: FlowOptions,
  prepareDispatch: PrepareOwnerShieldedDispatch<T>,
) {
  const { record, ports, readBinding, readChain, requirePure, read, findCounter, recordPure, run } =
    context;
  const { authoriser, viewingKey, network } = ports;
  const { networkId } = network;
  return run(options, async (flow) => {
    const transfer = prepareShieldedWithdrawal(request);
    const qualified = ports.holdings as QualifiedHoldingSource | undefined;
    const pure = requirePure((await readBinding()).pureCircuits);
    if (
      network.bindingId !== 'acc-s3r1.1' ||
      !pure.challenge_withdraw_shielded_with_jubjub ||
      !qualified?.selectQualifiedHeldCoins
    )
      throw new PassportConnectorError(
        'BindingUnsupported',
        'JubJub shielded withdrawal needs the pinned challenge and qualified holdings.',
      );
    if (record.status !== 'active')
      throw new PassportConnectorError('AccountNotFound', 'The JubJub ACC is not active.');
    recordPure.set(record, pure);
    return authoriser.withKeySession!(
      async () => {
        const pk = await authoriser.devicePublicKey();
        if (!samePoint(pk, record.publicKey))
          throw new PassportConnectorError(
            'NotAuthorised',
            'The selected device does not own this ACC.',
          );
        const view = await flow.step('chain.read', () => read(record));
        if (!view.booted || view.specVersion !== 3)
          throw new PassportConnectorError('AccountNotFound', 'The JubJub ACC is not active.');
        const counter = await flow.step('counter.scan', async () => findCounter(record, view));
        if (counter === undefined)
          throw new PassportConnectorError('NotAuthorised', 'This device has no live ACC entry.');
        const chainPort = await readChain();
        const loadCoin = (ledgerView: InboxLedgerView) =>
          readQualifiedHolding(
            {
              account: record.address,
              keyring: {
                account: record.address,
                encKey: ledgerView.encKey,
                envelopes: [...ledgerView.inboxEntries].reverse(),
              },
              inboxIndex: transfer.inboxIndex,
              color: transfer.color,
            },
            { networkId, chain: chainPort, viewingKey, holdings: qualified },
          );
        const coin = await loadCoin(view);
        const frontier = { authNonce: view.authNonce, deviceEpoch: view.deviceEpoch };
        const dispatch = await prepareDispatch({
          chain: chainPort,
          coin,
          counter,
          transfer,
          flow,
          async checkCurrent() {
            const latest = await flow.step('chain.read', () => read(record));
            if (findCounter(record, latest) !== counter)
              throw new PassportConnectorError(
                'MutationUnsettled',
                'The reviewed owner entry changed.',
              );
            assertSameOwnerShieldedInput(frontier, latest, coin, await loadCoin(latest));
          },
        });
        const self = { bytes: fromHex(record.address) };
        const circuit = 'withdraw_shielded_with_jubjub';
        const signed = await flow.step('passkey.sign', () =>
          authoriser.authorise({
            account: record.address,
            circuit,
            args: [transfer.recipient, transfer.color, transfer.amount],
            witnessValues: [coin],
            authNonce: frontier.authNonce,
            useCounter: counter,
            challenge: (sigR, grindNonce) =>
              pure.challenge_withdraw_shielded_with_jubjub!(
                self,
                sigR,
                record.publicKey,
                transfer.recipient,
                transfer.color,
                transfer.amount,
                coin,
                frontier.authNonce,
                grindNonce,
              ),
          }),
        );
        if (
          signed.scheme !== 'jubjub-schnorr' ||
          signed.useCounter !== counter ||
          !samePoint(signed.pk, record.publicKey)
        )
          throw new PassportConnectorError('NotAuthorised', 'The signature names another device.');
        flow.checkpoint();
        return dispatch({
          address: record.address,
          circuit,
          args: [
            transfer.recipient,
            transfer.color,
            transfer.amount,
            record.publicKey,
            counter,
            signed.sigR,
            signed.sigS,
            signed.grindNonce,
          ],
          heldCoin: coin,
          ...flow.ports,
        });
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
}

export function jubjubWithdrawals(
  context: JubjubWithdrawalContext,
): Required<Pick<PassportAccount, 'withdrawUnshielded' | 'withdrawShielded'>> &
  Pick<PassportAccount, 'withdrawShieldedPartial'> {
  const { record, ports, readBinding, readChain, requirePure, read, findCounter, recordPure, run } =
    context;
  const { authoriser, network } = ports;
  const { networkId } = network;
  return {
    withdrawUnshielded: (request, options = {}) =>
      run(options, async (flow) => {
        const transfer = prepareUnshieldedWithdrawal(request);
        const pure = requirePure((await readBinding()).pureCircuits);
        if (network.bindingId !== 'acc-s3r1.1' || !pure.challenge_withdraw_unshielded_with_jubjub)
          throw new PassportConnectorError(
            'BindingUnsupported',
            'JubJub withdrawal needs the pinned challenge circuit.',
          );
        if (record.status !== 'active')
          throw new PassportConnectorError('AccountNotFound', 'The JubJub ACC is not active.');
        recordPure.set(record, pure);
        return authoriser.withKeySession!(
          async () => {
            const pk = await authoriser.devicePublicKey();
            if (!samePoint(pk, record.publicKey))
              throw new PassportConnectorError(
                'NotAuthorised',
                'The selected device does not own this ACC.',
              );
            const view = await flow.step('chain.read', () => read(record));
            if (!view.booted || view.specVersion !== 3)
              throw new PassportConnectorError('AccountNotFound', 'The JubJub ACC is not active.');
            const counter = await flow.step('counter.scan', async () => findCounter(record, view));
            if (counter === undefined)
              throw new PassportConnectorError(
                'NotAuthorised',
                'This device has no live ACC entry.',
              );
            const self = { bytes: fromHex(record.address) };
            const circuit = 'withdraw_unshielded_with_jubjub';
            const signed = await flow.step('passkey.sign', () =>
              authoriser.authorise({
                account: record.address,
                circuit,
                args: [transfer.color, transfer.amount, transfer.recipient],
                witnessValues: [],
                authNonce: view.authNonce,
                useCounter: counter,
                challenge: (sigR, grindNonce) =>
                  pure.challenge_withdraw_unshielded_with_jubjub!(
                    self,
                    sigR,
                    record.publicKey,
                    transfer.color,
                    transfer.amount,
                    transfer.recipient,
                    view.authNonce,
                    grindNonce,
                  ),
              }),
            );
            if (
              signed.scheme !== 'jubjub-schnorr' ||
              signed.useCounter !== counter ||
              !samePoint(signed.pk, record.publicKey)
            )
              throw new PassportConnectorError(
                'NotAuthorised',
                'The signature names another device.',
              );
            flow.checkpoint();
            const tx = await (
              await readChain()
            ).call({
              address: record.address,
              circuit,
              args: [
                transfer.color,
                transfer.amount,
                transfer.recipient,
                record.publicKey,
                counter,
                signed.sigR,
                signed.sigS,
                signed.grindNonce,
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
      }),
    withdrawShielded: (request, options = {}) =>
      withdrawShieldedUsing(context, request, options, exactOwnerShieldedDispatch),
    ...(ports.partialShieldedWithdrawal && {
      async withdrawShieldedPartial(
        request: PassportPartialShieldedWithdrawal,
        options: FlowOptions = {},
      ) {
        const { requestId, transfer, publicIntentSha256 } =
          capturePartialShieldedWithdrawal(request);
        const capturedOptions = { ...options };
        const scope = { account: record.address, networkId, bindingId: network.bindingId };
        const host = validatePartialWithdrawalHost(
          requestId,
          scope,
          ports.partialShieldedWithdrawal,
        );
        return (
          (await existingPartialWithdrawal(requestId, publicIntentSha256, scope, host)) ??
          withdrawShieldedUsing(
            context,
            transfer,
            capturedOptions,
            partialOwnerShieldedDispatch(requestId, publicIntentSha256, scope, host),
          )
        );
      },
    }),
  };
}
