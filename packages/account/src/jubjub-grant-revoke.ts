import type { FlowOptions, PassportTxResult } from '@input-output-hk/mn-passport-protocol';
import { fromHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { startFlow } from './flow.js';
import { validGrantId } from './grant-publication-state.js';
import { JUBJUB_READER_SCAN_LIMIT } from './jubjub-readers.js';
import type {
  AccountHint,
  AccountRecordStore,
  Authoriser,
  Chain,
  CurvePoint,
  GrantDetailSource,
  JubjubPureCircuits,
} from './ports/index.js';

export interface RevokeJubjubGrantPure extends Pick<
  JubjubPureCircuits,
  'derive_device_entry_with_jubjub'
> {
  challenge_revoke_grant_with_jubjub(
    account: { readonly bytes: Uint8Array },
    sigR: CurvePoint,
    ownerPublicKey: CurvePoint,
    grantId: Uint8Array,
    authNonce: bigint,
    grindNonce: bigint,
  ): Uint8Array;
}

export type { GrantDetailSource } from './ports/index.js';

export interface RevokeJubjubGrantInput extends FlowOptions {
  readonly hint: AccountHint;
  readonly grantId: string;
}

export interface RevokeJubjubGrantPorts {
  readonly bindingId: 'acc-s3r1.1';
  readonly pure: RevokeJubjubGrantPure;
  readonly chain: Chain;
  readonly grants: GrantDetailSource;
  readonly authoriser: Authoriser;
  readonly records: AccountRecordStore;
  readonly random?: (length: number) => Uint8Array;
}

/** Chain submission only. A host must confirm the inactive tombstone before reporting revocation. */
export interface SubmittedJubjubGrantRevoke extends PassportTxResult {
  readonly grantId: string;
  readonly status: 'submitted';
  readonly nextUseCounter: bigint;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);
const samePoint = (a: { x: bigint; y: bigint }, b: { x: bigint; y: bigint }): boolean =>
  a.x === b.x && a.y === b.y;
const random = (length: number): Uint8Array =>
  (
    globalThis as unknown as { crypto: { getRandomValues(bytes: Uint8Array): Uint8Array } }
  ).crypto.getRandomValues(new Uint8Array(length));

/** Revoke an unshielded grant with the pinned JubJub circuit, without claiming settlement. */
export async function revokeJubjubGrantCall(
  input: RevokeJubjubGrantInput,
  ports: RevokeJubjubGrantPorts,
): Promise<SubmittedJubjubGrantRevoke> {
  const flow = startFlow(input, ports.random ?? random);
  try {
    const { hint, grantId } = input;
    if (!validGrantId(grantId))
      throw new PassportConnectorError('GrantScopeInvalid', 'The grant id must be 32-byte hex.');
    if (hint.scheme !== 'jubjub-schnorr' || hint.status !== 'active' || !hint.credentialId)
      throw new PassportConnectorError('NotAuthorised', 'An active JubJub device is required.');
    if (!(await ports.records.exists()))
      throw new PassportConnectorError('AccountNotFound', 'No local account record exists.');
    if (ports.authoriser.scheme !== 'jubjub-schnorr' || !ports.authoriser.withKeySession)
      throw new PassportConnectorError('BindingUnsupported', 'A JubJub key session is required.');
    const grant = await flow.step('grant.roster', () =>
      ports.grants.readGrant(hint.address, grantId),
    );
    if (!grant) throw new PassportConnectorError('GrantNotFound', 'The ACC has no such grant.');
    if (!grant.active)
      throw new PassportConnectorError('GrantRevoked', 'The grant is already revoked.');
    if (grant.read)
      throw new PassportConnectorError(
        'BindingUnsupported',
        'A read grant requires viewing-secret rotation before revocation.',
      );
    const view = await flow.step('chain.read', () =>
      ports.chain.readAccount(hint.address, { includeDevices: true }),
    );
    if (!view?.booted)
      throw new PassportConnectorError('AccountNotFound', 'The active ACC is missing.');
    if (view.specVersion !== 3)
      throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
    if (grant.authNonce !== view.authNonce)
      throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster is stale.');
    const self = { bytes: fromHex(hint.address) };
    const id = fromHex(grantId);
    return await ports.authoriser.withKeySession(
      async () => {
        const record = await ports.records.read();
        if (
          record?.scheme !== 'jubjub-schnorr' ||
          record.address !== hint.address ||
          record.bindingId !== ports.bindingId ||
          !record.credentialId ||
          !sameBytes(record.credentialId, hint.credentialId!)
        )
          throw new PassportConnectorError(
            'NotAuthorised',
            'The stored account is another device.',
          );
        const publicKey = await ports.authoriser.devicePublicKey();
        if (!samePoint(publicKey, hint.publicKey))
          throw new PassportConnectorError(
            'NotAuthorised',
            'The selected device does not own this ACC.',
          );
        const counter = await flow.step('counter.scan', async () => {
          for (let value = 0n; value < JUBJUB_READER_SCAN_LIMIT; value++) {
            if (
              view.hasEntry(
                ports.pure.derive_device_entry_with_jubjub(
                  self,
                  publicKey,
                  view.deviceEpoch,
                  value,
                ),
              )
            )
              return value;
          }
          throw new PassportConnectorError('NotAuthorised', 'The owner has no live device entry.');
        });
        const circuit = 'revoke_grant_with_jubjub';
        const signed = await flow.step('passkey.sign', () =>
          ports.authoriser.authorise({
            account: hint.address,
            circuit,
            args: [id],
            witnessValues: [],
            authNonce: view.authNonce,
            useCounter: counter,
            challenge: (sigR, grindNonce) =>
              ports.pure.challenge_revoke_grant_with_jubjub(
                self,
                sigR,
                publicKey,
                id,
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
        // Refuse a read grant that changed after the first roster lookup but before submission.
        const latest = await flow.step('grant.roster', () =>
          ports.grants.readGrant(hint.address, grantId),
        );
        if (!latest) throw new PassportConnectorError('GrantNotFound', 'The grant disappeared.');
        if (!latest.active)
          throw new PassportConnectorError('GrantRevoked', 'The grant is already revoked.');
        if (latest.read)
          throw new PassportConnectorError(
            'BindingUnsupported',
            'The grant now requires key rotation.',
          );
        if (latest.authNonce !== view.authNonce)
          throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster changed.');
        flow.checkpoint();
        const tx = await ports.chain.call({
          address: hint.address,
          circuit,
          args: [id, publicKey, counter, signed.sigR, signed.sigS, signed.grindNonce],
          ...flow.ports,
        });
        const nextUseCounter = counter + 1n;
        await ports.records.write({ ...record, localUseCounter: nextUseCounter });
        return { ...tx, grantId, status: 'submitted' as const, nextUseCounter };
      },
      { kind: 'revoke-grant', grantId },
    );
  } catch (error) {
    throw flow.fail(error);
  }
}
