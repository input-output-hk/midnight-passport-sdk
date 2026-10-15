import type {
  FlowOptions,
  PassportGrantRevokeAllResult,
  ViewingKeyRotationResult,
} from '@input-output-hk/mn-passport-protocol';
import { fromHex, toHex } from './codec.js';
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
  GrantRosterSource,
  JubjubPureCircuits,
} from './ports/index.js';

export interface RevokeAllJubjubGrantPure extends Pick<
  JubjubPureCircuits,
  'derive_device_entry_with_jubjub'
> {
  challenge_revoke_all_grants_with_jubjub(
    account: { readonly bytes: Uint8Array },
    sigR: CurvePoint,
    ownerPublicKey: CurvePoint,
    authNonce: bigint,
    grindNonce: bigint,
  ): Uint8Array;
}

export interface RevokeAllJubjubGrantsPorts {
  readonly bindingId: 'acc-s3r1.1';
  readonly pure: RevokeAllJubjubGrantPure;
  readonly chain: Chain;
  readonly grants: GrantRosterSource;
  readonly authoriser: Authoriser;
  readonly records: AccountRecordStore;
  readonly random?: (length: number) => Uint8Array;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly attempts?: number;
  /** Rotates without sealing any read grantee, inside the revoke-all key session. */
  readonly rotateBeforeRevokeAll?: (
    input: RevokeAllJubjubGrantsInput,
  ) => Promise<ViewingKeyRotationResult>;
}

export interface RevokeAllJubjubGrantsInput extends FlowOptions {
  readonly hint: AccountHint;
}

const random = (length: number): Uint8Array =>
  (
    globalThis as unknown as { crypto: { getRandomValues(bytes: Uint8Array): Uint8Array } }
  ).crypto.getRandomValues(new Uint8Array(length));
const sleep = (milliseconds: number): Promise<void> =>
  new Promise((done) =>
    (globalThis as unknown as { setTimeout(run: () => void, ms: number): unknown }).setTimeout(
      done,
      milliseconds,
    ),
  );
const sameBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((value, index) => value === b[index]);
const samePoint = (a: CurvePoint, b: CurvePoint): boolean => a.x === b.x && a.y === b.y;
type GrantRoster = Awaited<ReturnType<GrantRosterSource['readGrantRoster']>>;

function fingerprint(roster: GrantRoster): string {
  if (
    roster.authNonce < 0n ||
    roster.generation < 0n ||
    roster.generation >= 1n << 32n ||
    roster.entries.length > 4096 ||
    roster.entries.some(
      ({ id, active, read }) =>
        !validGrantId(id) || typeof active !== 'boolean' || typeof read !== 'boolean',
    ) ||
    new Set(roster.entries.map(({ id }) => id)).size !== roster.entries.length
  )
    throw new PassportConnectorError('BindingUnsupported', 'Invalid live ACC grant roster.');
  return roster.entries
    .map(({ id, active, read }) => `${id}:${Number(active)}:${Number(read)}`)
    .sort()
    .join('|');
}

/** Rotate away from live readers when needed, then clear and confirm the grant map. */
export async function revokeAllJubjubGrants(
  input: RevokeAllJubjubGrantsInput,
  ports: RevokeAllJubjubGrantsPorts,
): Promise<PassportGrantRevokeAllResult> {
  const attempts = ports.attempts ?? 30;
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 120)
    throw new PassportConnectorError('InternalError', 'Invalid grant settlement polling bound.');
  const flow = startFlow(input, ports.random ?? random);
  try {
    const { hint } = input;
    if (hint.scheme !== 'jubjub-schnorr' || hint.status !== 'active' || !hint.credentialId)
      throw new PassportConnectorError('NotAuthorised', 'An active JubJub device is required.');
    if (!(await ports.records.exists()))
      throw new PassportConnectorError('AccountNotFound', 'No local account record exists.');
    if (ports.authoriser.scheme !== 'jubjub-schnorr' || !ports.authoriser.withKeySession)
      throw new PassportConnectorError('BindingUnsupported', 'A JubJub key session is required.');
    let roster = await flow.step('grant.roster', () => ports.grants.readGrantRoster(hint.address));
    const baseline = fingerprint(roster);
    const originalGeneration = roster.generation;
    const hasRead = roster.entries.some(({ active, read }) => active && read);
    if (hasRead && !ports.rotateBeforeRevokeAll)
      throw new PassportConnectorError(
        'BindingUnsupported',
        'Live read grants require viewing-secret rotation before revoke-all.',
      );
    const initialView = await flow.step('chain.read', () =>
      ports.chain.readAccount(hint.address, { includeDevices: true }),
    );
    if (!initialView?.booted)
      throw new PassportConnectorError('AccountNotFound', 'The active ACC is missing.');
    if (initialView.specVersion !== 3)
      throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
    if (initialView.authNonce !== roster.authNonce)
      throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster is stale.');
    let view = initialView;
    const self = { bytes: fromHex(hint.address) };
    const credentialId = hint.credentialId;
    return await ports.authoriser.withKeySession(
      async () => {
        const record = await ports.records.read();
        if (
          record?.scheme !== 'jubjub-schnorr' ||
          record.address !== hint.address ||
          record.bindingId !== ports.bindingId ||
          !record.credentialId ||
          !sameBytes(record.credentialId, credentialId)
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
        let rotation: ViewingKeyRotationResult | undefined;
        if (hasRead) {
          rotation = await ports.rotateBeforeRevokeAll!(input);
          const rotatedView = await flow.step('chain.read', () =>
            ports.chain.readAccount(hint.address, { includeDevices: true }),
          );
          if (!rotatedView?.booted || rotatedView.specVersion !== 3)
            throw new PassportConnectorError('AccountNotFound', 'The rotated ACC is missing.');
          view = rotatedView;
          roster = await flow.step('grant.roster', () =>
            ports.grants.readGrantRoster(hint.address),
          );
          if (
            roster.authNonce !== view.authNonce ||
            roster.generation !== originalGeneration ||
            fingerprint(roster) !== baseline
          )
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'The grant roster changed during rotation.',
            );
        }
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
        const circuit = 'revoke_all_grants_with_jubjub';
        const signed = await flow.step('passkey.sign', () =>
          ports.authoriser.authorise({
            account: hint.address,
            circuit,
            args: [],
            witnessValues: [],
            authNonce: view.authNonce,
            useCounter: counter,
            challenge: (sigR, grindNonce) =>
              ports.pure.challenge_revoke_all_grants_with_jubjub(
                self,
                sigR,
                publicKey,
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
        const latest = await flow.step('grant.roster', () =>
          ports.grants.readGrantRoster(hint.address),
        );
        if (
          latest.authNonce !== view.authNonce ||
          latest.generation !== roster.generation ||
          fingerprint(latest) !== baseline
        )
          throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster changed.');
        flow.checkpoint();
        const tx = await ports.chain.call({
          address: hint.address,
          circuit,
          args: [publicKey, counter, signed.sigR, signed.sigS, signed.grindNonce],
          ...flow.ports,
        });
        const nextUseCounter = counter + 1n;
        await ports.records.write({ ...record, localUseCounter: nextUseCounter });
        const generation = (roster.generation + 1n) & ((1n << 32n) - 1n);
        await flow.step('grant.roster', async () => {
          for (let attempt = 0; attempt < attempts; attempt++) {
            flow.checkpoint();
            const current = await ports.grants.readGrantRoster(hint.address);
            fingerprint(current);
            if (
              current.authNonce > view.authNonce &&
              current.generation === generation &&
              current.entries.length === 0
            )
              return;
            if (attempt + 1 < attempts) await (ports.sleep ?? sleep)(1000);
          }
          throw new PassportConnectorError(
            'GrantRosterUnsettled',
            'The submitted revoke-all did not clear the live ACC grant map.',
          );
        });
        return {
          ...tx,
          status: 'cleared' as const,
          generation,
          nextUseCounter,
          ...(rotation && { rotation }),
        };
      },
      {
        kind: 'revoke-all-grants',
        account: hint.address,
        ...(hasRead && { read: true, devices: view.deviceEntries?.map(toHex) ?? [] }),
      },
    );
  } catch (error) {
    throw flow.fail(error);
  }
}
