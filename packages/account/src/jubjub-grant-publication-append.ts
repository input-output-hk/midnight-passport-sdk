import { PassportConnectorError } from './errors.js';
import { JUBJUB_READER_SCAN_LIMIT } from './jubjub-readers.js';
import { requirePublicationView } from './jubjub-grant-publication-plan.js';
import {
  publicationBytesEqual,
  publicationPointEqual,
  type PublicationView,
  type SelectedPublication,
} from './jubjub-grant-publication-types.js';
import type { JubjubAuthorisation } from './ports/index.js';

async function signPublicationEntry(
  selected: SelectedPublication,
  view: PublicationView,
  entry: () => Uint8Array,
): Promise<{ counter: bigint; signed: JubjubAuthorisation }> {
  const { operation, publicKey } = selected;
  const { ports, flow, hint, self } = operation;
  const counter = await flow.step('counter.scan', async () => {
    for (let value = 0n; value < JUBJUB_READER_SCAN_LIMIT; value++)
      if (
        view.hasEntry(
          ports.pure.derive_device_entry_with_jubjub(self, publicKey, view.deviceEpoch, value),
        )
      )
        return value;
    throw new PassportConnectorError('NotAuthorised', 'The owner device has no live entry.');
  });
  const signed = await flow.step('passkey.sign', () =>
    ports.authoriser.authorise({
      account: hint.address,
      circuit: 'append_inbox_with_jubjub',
      args: [entry()],
      witnessValues: [],
      authNonce: view.authNonce,
      useCounter: counter,
      challenge: (sigR, grindNonce) =>
        ports.pure.challenge_append_inbox_with_jubjub(
          self,
          sigR,
          publicKey,
          entry(),
          view.authNonce,
          grindNonce,
        ),
    }),
  );
  if (
    signed.scheme !== 'jubjub-schnorr' ||
    signed.useCounter !== counter ||
    !publicationPointEqual(signed.pk, publicKey)
  )
    throw new PassportConnectorError('NotAuthorised', 'The signature names another device.');
  return { counter, signed };
}

async function observePublicationEntry(
  selected: SelectedPublication,
  entry: () => Uint8Array,
  nonce: bigint,
  failureMessage: string,
): Promise<PublicationView> {
  const { ports, flow, hint, attempts, wait } = selected.operation;
  return flow.step('chain.read', async () => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      flow.checkpoint();
      const next = requirePublicationView(
        await ports.chain.readAccount(hint.address, { includeInbox: true, includeDevices: true }),
      );
      if (
        next.authNonce > nonce &&
        next.inboxEntries.some((held) => publicationBytesEqual(held, entry()))
      )
        return next;
      if (attempt + 1 < attempts) await wait(1000);
    }
    throw new PassportConnectorError('GrantBookkeepingUnsettled', failureMessage);
  });
}

/** Both publication kinds share this proof shape, single dispatch and local acknowledgement. */
export async function appendJubjubPublicationEntry(
  selected: SelectedPublication,
  view: PublicationView,
  entry: () => Uint8Array,
  failureMessage: string,
): Promise<PublicationView> {
  const { operation, publicKey, record } = selected;
  const { ports, flow, hint, appendTxHashes } = operation;
  const { counter, signed } = await signPublicationEntry(selected, view, entry);
  // JubJub publication captures the nonce after signing; P-256 has a different boundary.
  const nonce = view.authNonce;
  flow.checkpoint();
  const tx = await ports.chain.call({
    address: hint.address,
    circuit: 'append_inbox_with_jubjub',
    args: [entry(), publicKey, counter, signed.sigR, signed.sigS, signed.grindNonce],
    ...flow.ports,
  });
  appendTxHashes.push(tx.txHash);
  await ports.records.write({ ...record, localUseCounter: counter + 1n });
  return observePublicationEntry(selected, entry, nonce, failureMessage);
}
