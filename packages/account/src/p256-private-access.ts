import type { P256AccountContext, P256MethodArgs } from './p256-account-context.js';
import type { P256Hint } from './p256-device.js';
import { PassportConnectorError } from './errors.js';
import { fromHex } from './codec.js';
import { p256, isSealedP256 } from './p256-device.js';
import { readVerifiedHoldings } from './holdings.js';
import { equalBytes, deviceBinding, inboxView, holdingsSource } from './p256-operation-guards.js';
export class P256PrivateAccess {
  constructor(
    private readonly host: P256AccountContext,
    private readonly record: P256Hint,
  ) {}
  readShieldedHoldings = (options: P256MethodArgs<'readShieldedHoldings'>[0] = {}) => {
    const {
      ports,
      network,
      networkId,
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
      if (!isSealedP256(record) || !viewingKey || !ports.holdings || !authoriser.withKeySession)
        throw new PassportConnectorError(
          'BindingUnsupported',
          'P-256 holdings need a sealed keyring, key session and chain-backed holding source.',
        );
      const view = await readView(flow, record);
      if (!view.booted || record.status !== 'active')
        throw new PassportConnectorError('AccountNotFound', 'The P-256 ACC is not active.');
      if (view.specVersion !== 3)
        throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
      const counter = await findCounter(flow, record, view);
      if (counter === undefined) throw notHeld(record);
      const routine = ports.routineViewingKey?.({
        account: record.address,
        networkId,
        bindingId: network.bindingId,
        credentialId: Uint8Array.from(record.credentialId),
      });
      if (routine)
        return readVerifiedHoldings(
          {
            account: record.address,
            keyring: {
              account: record.address,
              encKey: inboxView(view).encKey,
              envelopes: [...inboxView(view).inboxEntries].reverse(),
            },
          },
          {
            networkId,
            chain: await chain(),
            authoriser: { withKeySession: async (work) => work() },
            viewingKey: routine,
            holdings: holdingsSource(ports),
          },
        );
      return authoriser.withKeySession(
        async () => {
          const selected = await authoriser.devicePublicKey();
          const binding = await deviceBinding(authoriser);
          if (
            selected.x !== record.publicKey.x ||
            selected.y !== record.publicKey.y ||
            !equalBytes(binding.credentialId, record.credentialId) ||
            !equalBytes(binding.policy.rp_id_hash, record.policy.rp_id_hash) ||
            !equalBytes(binding.policy.origin, record.policy.origin)
          )
            throw new PassportConnectorError(
              'NotAuthorised',
              'The selected passkey does not own this ACC.',
            );
          await sealedKeyring(record, view, false);
          return readVerifiedHoldings(
            {
              account: record.address,
              keyring: {
                account: record.address,
                encKey: inboxView(view).encKey,
                envelopes: [...inboxView(view).inboxEntries].reverse(),
              },
            },
            {
              networkId,
              chain: await chain(),
              authoriser,
              viewingKey,
              holdings: holdingsSource(ports),
            },
          );
        },
        { kind: 'read-holdings', account: record.address },
      );
    });
  };
  rotateEncryptionKey = (
    newKey: P256MethodArgs<'rotateEncryptionKey'>[0],
    options: P256MethodArgs<'rotateEncryptionKey'>[1] = {},
  ) => {
    const { binding, authoriser, useCounter, chain, run } = this.host;
    const record = this.record;
    return run(options, async (flow) => {
      if (isSealedP256(record))
        throw new PassportConnectorError(
          'BindingUnsupported',
          'Sealed P-256 accounts require roster-safe viewing-key rotation.',
        );
      newKey = Uint8Array.from(newKey);
      const { counter, authNonce } = await useCounter(flow, record);
      const self = { bytes: fromHex(record.address) };
      const circuit = 'rotate_enc_key_with_p256';
      const challenge = (await binding()).pureCircuits.challenge_rotate_enc_key_with_p256(
        self,
        p256(record.publicKey),
        newKey,
        authNonce,
      );
      const signed = await flow.step('passkey.sign', () =>
        authoriser.authorise({
          account: record.address,
          circuit,
          args: [newKey],
          witnessValues: [],
          authNonce,
          useCounter: counter,
          challenge,
          credentialId: record.credentialId,
        }),
      );
      if (signed.scheme !== 'p256-webauthn') {
        throw new PassportConnectorError('InternalError', `A ${signed.scheme} authorisation.`);
      }
      const auth = {
        pk: p256(record.publicKey),
        policy: record.policy,
        authenticator_data: signed.authenticatorData,
        sig: signed.sig,
        use_counter: counter,
      };
      flow.checkpoint();
      // The chain port reports its own steps (prove, sponsor.*, chain.finality) through `onEvent`.
      return (await chain()).call({
        address: record.address,
        circuit,
        args: [newKey, auth],
        ...flow.ports,
      });
    });
  };
}
