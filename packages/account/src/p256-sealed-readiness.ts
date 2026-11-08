import { fromHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import type { Flow } from './flow.js';
import { p256, type P256Hint, type SealedP256Hint } from './p256-device.js';
import { submitInitialActivation, writeActiveHint } from './p256-activation.js';
import { readinessEqual, type P256ReadinessHost } from './p256-readiness-types.js';
import { authenticateSealedReader, observeSealedAccount } from './p256-sealed-reader.js';
import type { AccLedgerView, P256Authorisation } from './ports/index.js';

async function signCreationEntry(
  host: P256ReadinessHost,
  flow: Flow,
  record: SealedP256Hint,
  entry: Uint8Array,
  view: AccLedgerView,
): Promise<{ counter: bigint; signed: P256Authorisation }> {
  const pure = (await host.binding()).pureCircuits;
  if (!pure.challenge_append_inbox_with_p256)
    throw new PassportConnectorError('BindingUnsupported', 'ACC lacks P-256 inbox signing.');
  const counter = await host.findCounter(flow, record, view);
  if (counter === undefined) throw host.notHeld(record);
  const challenge = pure.challenge_append_inbox_with_p256(
    { bytes: fromHex(record.address) },
    p256(record.publicKey),
    entry,
    view.authNonce,
  );
  const signed = await flow.step('passkey.sign', () =>
    host.authoriser.authorise({
      account: record.address,
      circuit: 'append_inbox_with_p256',
      args: [entry],
      witnessValues: [],
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
    throw new PassportConnectorError('NotAuthorised', 'The signature names another device.');
  return { counter, signed };
}

/** Submit once, then observe nonce advancement without inventing a replacement publication. */
export async function appendP256InboxEntry(
  host: P256ReadinessHost,
  flow: Flow,
  record: SealedP256Hint,
  entry: Uint8Array,
  view: AccLedgerView,
): Promise<AccLedgerView> {
  const { counter, signed } = await signCreationEntry(host, flow, record, entry, view);
  flow.checkpoint();
  await (
    await host.chain()
  ).call({
    address: record.address,
    circuit: 'append_inbox_with_p256',
    args: [
      entry,
      {
        pk: p256(record.publicKey),
        policy: record.policy,
        authenticator_data: signed.authenticatorData,
        sig: signed.sig,
        use_counter: counter,
      },
    ],
    ...flow.ports,
  });
  return observeSealedAccount(host, record, (candidate) => candidate.authNonce > view.authNonce);
}

async function publishMissingCreationEntries(
  host: P256ReadinessHost,
  flow: Flow,
  record: SealedP256Hint,
  entries: readonly Uint8Array[],
  view: AccLedgerView,
): Promise<AccLedgerView> {
  for (const entry of entries) {
    if (view.inboxEntries?.some((held) => readinessEqual(held, entry))) continue;
    view = await appendP256InboxEntry(host, flow, record, entry, view);
  }
  return view;
}

export async function finishSealedAccount(
  host: P256ReadinessHost,
  flow: Flow,
  record: SealedP256Hint,
): Promise<P256Hint> {
  let view = await observeSealedAccount(host, record, (candidate) =>
    Boolean(candidate.encKey && candidate.inboxEntries),
  );
  const pending = record.status === 'deployed';
  const authenticated = await authenticateSealedReader(host, record, view, pending);
  if (!view.booted) {
    if (!pending) throw new PassportConnectorError('AccountNotFound', 'The ACC is not booted.');
    await submitInitialActivation(host, flow, record);
    view = await observeSealedAccount(host, record, (candidate) => candidate.booted);
  }
  if ((await host.findCounter(flow, record, view)) === undefined) throw host.notHeld(record);
  if (authenticated.pendingRecord)
    view = await publishMissingCreationEntries(
      host,
      flow,
      record,
      authenticated.pendingRecord.keyEntries,
      view,
    );
  await authenticateSealedReader(host, record, view, false);
  const active: P256Hint = { ...record, status: 'active' };
  if (pending) await writeActiveHint(host, flow, active);
  const counter = await host.findCounter(flow, active, view);
  if (counter === undefined) throw host.notHeld(active);
  // This raw write is part of the durable transcript, not another Flow step/checkpoint.
  await host.ports.records?.write({
    address: active.address,
    bindingId: host.network.bindingId,
    scheme: 'p256-webauthn',
    credentialId: Uint8Array.from(active.credentialId),
    localUseCounter: counter,
  });
  return active;
}
