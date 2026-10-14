import type { FlowOptions, PassportTxResult } from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { startFlow } from './flow.js';
import { JUBJUB_READER_SCAN_LIMIT } from './jubjub-readers.js';
import type {
  AccountHint,
  AccountRecordStore,
  Authoriser,
  Chain,
  CurvePoint,
  JubjubPureCircuits,
} from './ports/index.js';

/** The two pinned ACC pure helpers used to authorise a JubJub device entry. */
export interface AddJubjubDevicePure extends Pick<
  JubjubPureCircuits,
  'derive_device_entry_with_jubjub'
> {
  challenge_add_device_with_jubjub(
    account: { readonly bytes: Uint8Array },
    sigR: CurvePoint,
    ownerPublicKey: CurvePoint,
    newEntry: Uint8Array,
    authNonce: bigint,
    grindNonce: bigint,
  ): Uint8Array;
}

export interface AddJubjubAuthorisingDeviceInput extends FlowOptions {
  readonly hint: AccountHint;
  /** Public key from the joining device, used to derive its epoch-zero entry. */
  readonly joiningPublicKey: CurvePoint;
}

export interface AddJubjubAuthorisingDevicePorts {
  /** The pinned binding that supplies `pure`; checked against the stored account record. */
  readonly bindingId: 'acc-s3r1.1';
  readonly pure: AddJubjubDevicePure;
  readonly chain: Chain;
  readonly authoriser: Authoriser;
  readonly records: AccountRecordStore;
  readonly random?: (length: number) => Uint8Array;
}

export interface AddedJubjubAuthorisingDevice extends PassportTxResult {
  readonly commitmentHex: string;
  readonly nextUseCounter: bigint;
}

const samePoint = (a: CurvePoint, b: CurvePoint): boolean => a.x === b.x && a.y === b.y;
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);
const random = (length: number): Uint8Array =>
  (
    globalThis as unknown as { crypto: { getRandomValues(bytes: Uint8Array): Uint8Array } }
  ).crypto.getRandomValues(new Uint8Array(length));

/**
 * Enrol a JubJub authorising entry derived from a joining device's public key. This intentionally
 * delivers no viewing secret or reader registration: the new device can authorise ACC calls, but
 * cannot read shielded holdings until a separate, consented key-delivery flow is implemented.
 * The caller's record is advanced after the chain call so the next flow starts at its new counter.
 */
export async function addJubjubAuthorisingDevice(
  input: AddJubjubAuthorisingDeviceInput,
  ports: AddJubjubAuthorisingDevicePorts,
): Promise<AddedJubjubAuthorisingDevice> {
  const flow = startFlow(input, ports.random ?? random);
  try {
    const { hint } = input;
    const record = await ports.records.read();
    if (
      hint.scheme !== 'jubjub-schnorr' ||
      record?.scheme !== 'jubjub-schnorr' ||
      hint.status !== 'active' ||
      hint.address !== record.address ||
      record.bindingId !== ports.bindingId ||
      !hint.credentialId ||
      !record.credentialId ||
      !sameBytes(hint.credentialId, record.credentialId)
    )
      throw new PassportConnectorError('NotAuthorised', 'The active JubJub account is required.');
    if (ports.authoriser.scheme !== 'jubjub-schnorr' || !ports.authoriser.withKeySession)
      throw new PassportConnectorError('BindingUnsupported', 'A JubJub key session is required.');
    if (samePoint(hint.publicKey, input.joiningPublicKey))
      throw new PassportConnectorError(
        'NotAuthorised',
        'The joining device must have a distinct key.',
      );
    const view = await flow.step('chain.read', () =>
      ports.chain.readAccount(hint.address, { includeDevices: true }),
    );
    if (!view || !view.booted)
      throw new PassportConnectorError('AccountNotFound', 'The active ACC is missing.');
    if (view.specVersion !== 3)
      throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
    const self = { bytes: fromHex(hint.address) };
    const entry = ports.pure.derive_device_entry_with_jubjub(
      self,
      input.joiningPublicKey,
      view.deviceEpoch,
      0n,
    );
    if (entry.length !== 32)
      throw new PassportConnectorError('InternalError', 'The binding returned an invalid entry.');
    if (view.hasEntry(entry))
      throw new PassportConnectorError('NotAuthorised', 'The device entry is already live.');
    const commitmentHex = toHex(entry);
    return await ports.authoriser.withKeySession(
      async () => {
        const publicKey = await ports.authoriser.devicePublicKey();
        if (!samePoint(publicKey, hint.publicKey))
          throw new PassportConnectorError(
            'NotAuthorised',
            'The selected device does not own this ACC.',
          );
        const counter = await flow.step('counter.scan', async () => {
          for (let value = 0n; value < JUBJUB_READER_SCAN_LIMIT; value++) {
            const own = ports.pure.derive_device_entry_with_jubjub(
              self,
              publicKey,
              view.deviceEpoch,
              value,
            );
            if (view.hasEntry(own)) return value;
          }
          throw new PassportConnectorError(
            'NotAuthorised',
            'The selected device has no live entry.',
          );
        });
        const circuit = 'add_device_with_jubjub';
        const signed = await flow.step('passkey.sign', () =>
          ports.authoriser.authorise({
            account: hint.address,
            circuit,
            args: [entry],
            witnessValues: [],
            authNonce: view.authNonce,
            useCounter: counter,
            challenge: (sigR, grindNonce) =>
              ports.pure.challenge_add_device_with_jubjub(
                self,
                sigR,
                publicKey,
                entry,
                view.authNonce,
                grindNonce,
              ),
          }),
        );
        if (
          signed.scheme !== 'jubjub-schnorr' ||
          signed.useCounter !== counter ||
          !samePoint(signed.pk, publicKey)
        )
          throw new PassportConnectorError('NotAuthorised', 'The signature names another device.');
        flow.checkpoint();
        const tx = await ports.chain.call({
          address: hint.address,
          circuit,
          args: [entry, publicKey, counter, signed.sigR, signed.sigS, signed.grindNonce],
          ...flow.ports,
        });
        const nextUseCounter = counter + 1n;
        await ports.records.write({ ...record, localUseCounter: nextUseCounter });
        return { ...tx, commitmentHex, nextUseCounter };
      },
      { kind: 'add-device', commitmentHex },
    );
  } catch (error) {
    throw flow.fail(error);
  }
}
