import { openP256Address } from './p256-address-open.js';
import { finishPendingActivation } from './p256-activation.js';
import { PassportConnectorError } from './errors.js';
import type { Flow } from './flow.js';
import { isP256, isSealedP256, type P256Hint } from './p256-device.js';
import { readinessEqual, type P256ReadinessHost } from './p256-readiness-types.js';
import { authenticateSealedReader } from './p256-sealed-reader.js';
import { finishSealedAccount } from './p256-sealed-readiness.js';
import type { AccLedgerView } from './ports/index.js';

/** Unknown versions and post-gated-call keys cannot be compared to a legacy derivation. */
const encKeyComparable = (
  view: AccLedgerView,
): view is AccLedgerView & { readonly encKey: Uint8Array } =>
  view.encKey !== undefined && view.authNonce === 0n && view.specVersion === 2;

export async function openKnownP256Account(
  host: P256ReadinessHost,
  flow: Flow,
  address: string,
): Promise<P256Hint> {
  if (!/^[0-9a-f]{64}$/.test(address))
    throw new PassportConnectorError(
      'AccountNotFound',
      'ACC address must be 32-byte lowercase hex.',
    );
  if (!host.viewingKey || !host.authoriser.devicePublicKeyHex)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'Address recovery needs a sealed P-256 keyring.',
    );
  const identity = await flow.step('passkey.identify', () => host.credentials.identify());
  const { record, view } = await openP256Address(
    address,
    host.networkId,
    identity,
    host.authoriser,
    host.viewingKey,
    await host.chain(),
    flow,
  );
  const counter = await host.findCounter(flow, record, view);
  if (counter === undefined) throw host.notHeld(record);
  await authenticateSealedReader(host, record, view, false);
  await host.ports.records?.write({
    address,
    bindingId: host.network.bindingId,
    scheme: 'p256-webauthn',
    credentialId: Uint8Array.from(record.credentialId),
    localUseCounter: counter,
  });
  return record;
}

export async function openDirectoryP256Account(
  host: P256ReadinessHost,
  flow: Flow,
): Promise<P256Hint> {
  const identity = await flow.step('passkey.identify', () => host.credentials.identify());
  const hint = await flow.step('directory.read', async () =>
    host.directory?.get(host.networkId, {
      kind: 'credential-id',
      credentialId: identity.credentialId,
    }),
  );
  if (!hint)
    throw new PassportConnectorError(
      'AccountNotFound',
      'No Passport account for this passkey on this network.',
    );
  // Directory data is an untrusted hint; verify the selected credential and live owner.
  if (
    !isP256(hint) ||
    !readinessEqual(hint.credentialId, identity.credentialId) ||
    !identity.owns(hint.publicKey, hint.policy)
  )
    throw new PassportConnectorError(
      'AccountNotFound',
      'The registry record does not belong to this passkey.',
    );
  const view = await host.readView(flow, hint);
  if (
    (hint.status === 'active' || view.booted) &&
    (await host.findCounter(flow, hint, view)) === undefined
  )
    throw host.notHeld(hint);
  if (host.viewingKey) {
    if (!isSealedP256(hint))
      throw new PassportConnectorError(
        'BindingUnsupported',
        'This P-256 account has no sealed viewing key; use the legacy adapter or migrate it.',
      );
    return finishSealedAccount(host, flow, hint);
  }
  if (encKeyComparable(view)) {
    const derived = await flow.step('passkey.prf', () =>
      host.encryptionKey.publicKey(host.networkId),
    );
    if (!readinessEqual(derived, view.encKey))
      throw new PassportConnectorError(
        'EncryptionKeyMismatch',
        `The account at ${hint.address} holds an encryption key this passkey does not derive.`,
      );
  }
  return hint.status === 'active' ? hint : finishPendingActivation(host, flow, hint, view);
}
