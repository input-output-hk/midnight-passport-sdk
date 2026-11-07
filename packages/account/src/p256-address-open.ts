import { toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import type { Flow } from './flow.js';
import type { P256Hint } from './p256-device.js';
import type {
  AccountViewingKey,
  Authoriser,
  Chain,
  CredentialPort,
  DeviceReader,
  WebAuthnPolicy,
} from './ports/index.js';

const same = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

/** Recover the selected P-256 key from authenticated live metadata before using adapter state. */
export async function openP256Address(
  address: string,
  networkId: string,
  identity: Awaited<ReturnType<CredentialPort['identify']>>,
  authoriser: Authoriser,
  viewingKey: AccountViewingKey,
  chain: Chain,
  flow: Flow,
) {
  const view = await flow.step('chain.read', () =>
    chain.readAccount(address, { includeInbox: true }),
  );
  if (!view?.booted || view.specVersion !== 3)
    throw new PassportConnectorError(
      'AccountNotFound',
      'The selected ACC is not an active spec-3 account.',
    );
  const known = await selectedRecord(address, identity, authoriser);
  if (known) return { record: known, view };
  const decode = viewingKey.decodeP256DevicePublicKey?.bind(viewingKey);
  if (!decode)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'Cold P-256 address recovery needs a sealed registration decoder.',
    );
  let registrations: DeviceReader[];
  if (!view.encKey || !view.inboxEntries)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'Address recovery needs the live ACC inbox and encryption key.',
    );
  try {
    const reader = toHex(await viewingKey.readerPublicKey(networkId));
    const opened = await viewingKey.openInbox(
      networkId,
      { account: address, encKey: view.encKey, envelopes: [...view.inboxEntries].reverse() },
      view.inboxEntries,
    );
    registrations = opened.flatMap((entry) =>
      entry?.kind === 'device' &&
      entry.device.scheme === 'p256-webauthn' &&
      entry.device.readerPublicKey === reader &&
      entry.device.policy
        ? [entry.device]
        : [],
    );
  } catch (cause) {
    throw new PassportConnectorError(
      'EncryptionKeyMismatch',
      'No sealed envelope for this passkey opens the ACC encryption key.',
      { cause },
    );
  }
  const matching = registrations.filter((reader) => {
    const key = decode(reader.devicePublicKey);
    return key && identity.owns(key, reader.policy);
  });
  if (matching.length !== 1)
    throw new PassportConnectorError(
      'NotAuthorised',
      'The live ACC has no unique P-256 registration for this passkey.',
    );
  // A successful owns() above initializes a fresh browser adapter's selected key and binding.
  const record = await selectedRecord(address, identity, authoriser);
  if (!record || !registrationsMatch(record.publicKey, record.policy, matching, decode))
    throw new PassportConnectorError(
      'NotAuthorised',
      'The selected key differs from its sealed registration.',
    );
  return { record, view };
}

async function selectedRecord(
  address: string,
  identity: Awaited<ReturnType<CredentialPort['identify']>>,
  authoriser: Authoriser,
): Promise<(P256Hint & { readonly sealed: true }) | undefined> {
  const deviceBinding = authoriser.deviceBinding?.bind(authoriser);
  if (!deviceBinding)
    throw new PassportConnectorError('BindingUnsupported', 'P-256 opening needs a device binding.');
  let publicKey, device;
  try {
    publicKey = await authoriser.devicePublicKey();
    device = await deviceBinding();
  } catch (error) {
    // A fresh browser adapter has no public P-256 record until the assertion proves a key.
    if (error instanceof PassportConnectorError && error.code === 'InternalError') return undefined;
    throw error;
  }
  if (!same(identity.credentialId, device.credentialId) || !identity.owns(publicKey, device.policy))
    throw new PassportConnectorError(
      'NotAuthorised',
      'The selected passkey does not match its device binding.',
    );
  return {
    address,
    scheme: 'p256-webauthn',
    credentialId: Uint8Array.from(identity.credentialId),
    publicKey,
    policy: device.policy,
    status: 'active',
    sealed: true,
  };
}

function registrationsMatch(
  publicKey: { readonly x: bigint; readonly y: bigint },
  policy: WebAuthnPolicy,
  registrations: readonly DeviceReader[],
  decode: NonNullable<AccountViewingKey['decodeP256DevicePublicKey']>,
) {
  return registrations.some((reader) => {
    const key = decode(reader.devicePublicKey);
    return (
      key?.x === publicKey.x &&
      key.y === publicKey.y &&
      reader.policy &&
      same(policy.rp_id_hash, reader.policy.rp_id_hash) &&
      same(policy.origin, reader.policy.origin)
    );
  });
}
