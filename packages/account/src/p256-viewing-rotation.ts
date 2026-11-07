/** P-256 viewing-key rotation/removal owns its ordering and live-state fences. */
import type {
  FlowOptions,
  ViewingKeyRotationResult,
  DeviceRemovalResult,
} from '@input-output-hk/mn-passport-protocol';
import type { AccBinding, AccLedgerView, Chain, PassportPorts } from './ports/index.js';
import type { Flow } from './flow.js';
import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { type P256Hint, type SealedP256Hint, isSealedP256, p256 } from './p256-device.js';
import { resolveRegisteredReaders } from './jubjub-readers.js';
import { resolveRemovalReader } from './removal-reader.js';
import { sealActiveReadGrants } from './read-grant-deliveries.js';
const equalBytes = (a: Uint8Array, b: Uint8Array) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

export function createP256ViewingRotation(context: {
  ports: Pick<PassportPorts, 'authoriser' | 'viewingKey' | 'network' | 'holdings' | 'readGrants'>;
  binding(): Promise<AccBinding>;
  chain(): Promise<Chain>;
  run<T>(options: FlowOptions, body: (flow: Flow) => Promise<T>): Promise<T>;
  findCounter(flow: Flow, record: P256Hint, view: AccLedgerView): Promise<bigint | undefined>;
  notHeld(record: P256Hint): PassportConnectorError;
  sealedKeyring(
    record: SealedP256Hint,
    view: AccLedgerView,
    pending: boolean,
    inOwnerSession: boolean,
  ): Promise<unknown>;
  appendP256(
    flow: Flow,
    record: SealedP256Hint,
    entry: Uint8Array,
    view: AccLedgerView,
  ): Promise<AccLedgerView>;
  awaitSealedView(
    record: SealedP256Hint,
    ready: (view: AccLedgerView) => boolean,
  ): Promise<AccLedgerView>;
  random(length: number): Uint8Array;
  sleep(ms: number): Promise<void>;
}) {
  const {
    ports,
    binding,
    chain,
    run,
    findCounter,
    notHeld,
    sealedKeyring,
    appendP256,
    awaitSealedView,
    random,
    sleep,
  } = context;
  const {
    authoriser,
    viewingKey,
    network: { networkId },
  } = ports;
  return (
    record: P256Hint,
    options: FlowOptions = {},
    removal?: string,
    excludedGrant?: string | 'all',
    onRotated?: (state: { readonly encKey: Uint8Array; readonly authNonce: bigint }) => void,
    controls: {
      readonly inOwnerSession?: boolean;
      readonly rotateRosterForEnrollment?: boolean;
    } = {},
  ) =>
    run(options, async (flow): Promise<ViewingKeyRotationResult | DeviceRemovalResult> => {
      const keyring = viewingKey;
      const reencrypt = keyring?.reencryptInbox;
      const decodeJubjub = keyring?.decodeDevicePublicKey;
      const decodeP256 = keyring?.decodeP256DevicePublicKey;
      const pure = (await binding()).pureCircuits;
      if (
        !isSealedP256(record) ||
        !keyring ||
        !reencrypt ||
        !decodeJubjub ||
        !decodeP256 ||
        !pure.derive_device_entry_with_jubjub ||
        !pure.challenge_append_inbox_with_p256 ||
        (removal !== undefined && !pure.challenge_remove_device_with_p256) ||
        !ports.holdings ||
        !ports.readGrants ||
        !authoriser.withKeySession ||
        !authoriser.deviceBinding ||
        !authoriser.devicePublicKeyHex
      )
        throw new PassportConnectorError(
          'BindingUnsupported',
          'P-256 rotation needs sealed keys, both device decoders, verified holdings and a complete read-grant source.',
        );
      if (removal !== undefined && !/^[0-9a-f]{64}$/i.test(removal))
        throw new PassportConnectorError(
          'RemovalTargetNotFound',
          'The target must be a 32-byte device commitment.',
        );
      const target = removal === undefined ? undefined : fromHex(removal.toLowerCase());
      const read = async () => {
        const view = await flow.step('chain.read', async () =>
          (await chain()).readAccount(record.address, { includeInbox: true, includeDevices: true }),
        );
        if (!view) throw new PassportConnectorError('AccountNotFound', 'The ACC is absent.');
        if (!view.encKey || !view.inboxEntries || !view.deviceEntries)
          throw new PassportConnectorError(
            'BindingUnsupported',
            'The chain port omits the ACC key, inbox or live devices.',
          );
        return view as AccLedgerView & {
          readonly encKey: Uint8Array;
          readonly inboxEntries: readonly Uint8Array[];
          readonly deviceEntries: readonly Uint8Array[];
        };
      };
      const withSession: NonNullable<typeof authoriser.withKeySession> = controls.inOwnerSession
        ? (operation) => operation()
        : (operation, descriptor) => authoriser.withKeySession!(operation, descriptor);
      return withSession(
        async () => {
          const selected = await authoriser.devicePublicKey();
          const selectedBinding = await authoriser.deviceBinding!();
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
          let view = await read();
          if (!view.booted || record.status !== 'active')
            throw new PassportConnectorError('AccountNotFound', 'The P-256 ACC is not active.');
          if (view.specVersion !== 3)
            throw new PassportConnectorError(
              'BindingUnsupported',
              'The ACC spec version is not 3.',
            );
          const initialCounter = await findCounter(flow, record, view);
          if (initialCounter === undefined) throw notHeld(record);
          if (target) {
            const own = pure.derive_device_entry_with_p256(
              { bytes: fromHex(record.address) },
              p256(record.publicKey),
              record.policy,
              view.deviceEpoch,
              initialCounter,
            );
            if (equalBytes(target, own))
              throw new PassportConnectorError('LastDevice', 'A device cannot remove itself.');
            if (!view.deviceEntries.some((entry) => equalBytes(entry, target)))
              throw new PassportConnectorError('RemovalTargetNotFound', 'The target is not live.');
          }
          await sealedKeyring(record, view, false, true);
          const oldEntries = [...view.inboxEntries];
          const oldKeyring = {
            account: record.address,
            encKey: view.encKey,
            envelopes: [...oldEntries].reverse(),
          };
          const opened = await keyring.openInbox(networkId, oldKeyring, oldEntries);
          if (opened.length !== oldEntries.length)
            throw new PassportConnectorError(
              'InternalError',
              'The keyring returned an incomplete inbox.',
            );
          const ownerReader = toHex(await keyring.readerPublicKey(networkId));
          const ownerDevice = await authoriser.devicePublicKeyHex!();
          const roster = resolveRegisteredReaders({
            account: record.address,
            epoch: view.deviceEpoch,
            registered: opened.flatMap((item) => (item?.kind === 'device' ? [item.device] : [])),
            liveEntries: view.deviceEntries,
            ...(target && {
              allowedEntries: view.deviceEntries.filter((entry) => !equalBytes(entry, target)),
            }),
            pure: { derive_device_entry_with_jubjub: pure.derive_device_entry_with_jubjub! },
            p256Pure: pure,
            decodeDevicePublicKey: decodeJubjub,
            decodeP256DevicePublicKey: decodeP256,
          });
          if (
            roster.dropped.length ||
            !roster.readers.some(
              (reader) =>
                reader.readerPublicKey === ownerReader &&
                reader.devicePublicKey === ownerDevice &&
                reader.scheme === 'p256-webauthn' &&
                reader.policy &&
                equalBytes(reader.policy.rp_id_hash, record.policy.rp_id_hash) &&
                equalBytes(reader.policy.origin, record.policy.origin),
            )
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'Every live device needs one unique registered reader before rotation.',
            );
          const removedReader = target ? await resolveRemovalReader(roster) : undefined;
          const initial = view;
          const held = await ports.holdings!.selectHeldEntries(record.address, oldEntries, opened);
          const seen = new Set<number>();
          const holdingEntries: Uint8Array[] = [];
          for (const index of held) {
            if (
              !Number.isSafeInteger(index) ||
              index < 0 ||
              index >= oldEntries.length ||
              seen.has(index) ||
              opened[index]?.kind !== 'coin'
            )
              throw new PassportConnectorError('InternalError', 'Invalid verified holding index.');
            seen.add(index);
            holdingEntries.push(oldEntries[index]!);
          }
          const registrations = oldEntries.filter(
            (entry) =>
              entry.length === 192 &&
              (entry[1] === 1 || entry[1] === 2) &&
              (entry[0] === 0xd2 || entry[0] === 0xd4 || entry[0] === 0xd5),
          );
          const keys = await keyring.createKeys(networkId, {
            scheme: 'p256-webauthn',
            devicePublicKey: ownerDevice,
            policy: record.policy,
            keyring: oldKeyring,
            registrations,
            readers: roster.readers.filter((reader) => reader.readerPublicKey !== ownerReader),
            ...((target || controls.rotateRosterForEnrollment) && { rotateRoster: true }),
            ...(removedReader && {
              removed: {
                devicePublicKey: removedReader.devicePublicKey,
                epoch: removedReader.epoch,
                counter: removedReader.counter,
              },
            }),
          });
          const reencrypted = await reencrypt(
            networkId,
            { keyring: oldKeyring, to: keys.encKey },
            holdingEntries,
          );
          if (
            reencrypted.length !== holdingEntries.length ||
            reencrypted.some((entry) => !(entry instanceof Uint8Array))
          )
            throw new PassportConnectorError(
              'InternalError',
              'A verified holding could not be resealed.',
            );
          const deliveries = await sealActiveReadGrants(
            {
              networkId,
              keyring: { account: record.address, encKey: keys.encKey, envelopes: keys.envelopes },
              authNonce: view.authNonce,
              ...(excludedGrant === 'all' && { exceptAll: true }),
              ...(excludedGrant && excludedGrant !== 'all' && { exceptGrantId: excludedGrant }),
              ...flow.ports,
            },
            { targets: ports.readGrants!, viewingKey: keyring, random },
          );
          if (
            excludedGrant &&
            excludedGrant !== 'all' &&
            !deliveries.targets.some(({ grantId }) => grantId === excludedGrant)
          )
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'The read grant disappeared before key rotation.',
            );
          if (deliveries.unsealedGrantIds.length)
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'A surviving read grantee cannot receive the fresh key.',
            );
          if (
            removedReader &&
            deliveries.targets.some(
              ({ readPublicKey }) => readPublicKey === removedReader.readerPublicKey,
            )
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'An active read grant would return the fresh key to the removed reader.',
            );
          const appended = [
            ...keys.envelopes,
            ...keys.registrations,
            ...deliveries.sealed.map(({ entry }) => entry),
          ];
          for (const entry of appended) {
            await appendP256(flow, record, entry, view);
            view = await read();
          }
          if (
            !equalBytes(view.encKey, initial.encKey) ||
            view.deviceEpoch !== initial.deviceEpoch ||
            view.authNonce !== initial.authNonce + BigInt(appended.length)
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The ACC changed during key delivery.',
            );
          const ownerEntry = (counter: bigint) =>
            pure.derive_device_entry_with_p256(
              { bytes: fromHex(record.address) },
              p256(record.publicKey),
              record.policy,
              view.deviceEpoch,
              counter,
            );
          const other = (entries: readonly Uint8Array[], own: Uint8Array) =>
            entries
              .filter((entry) => !equalBytes(entry, own))
              .map(toHex)
              .sort();
          const counter = await findCounter(flow, record, view);
          if (counter === undefined) throw notHeld(record);
          const baseline = other(initial.deviceEntries, ownerEntry(initialCounter));
          const current = other(view.deviceEntries, ownerEntry(counter));
          if (
            baseline.length !== current.length ||
            current.some((entry, i) => entry !== baseline[i])
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The live device roster changed.',
            );
          const expected = new Map<string, number>();
          for (const entry of [...oldEntries, ...appended]) {
            const value = toHex(entry);
            expected.set(value, (expected.get(value) ?? 0) + 1);
          }
          for (const entry of view.inboxEntries) {
            const value = toHex(entry);
            const count = expected.get(value) ?? 0;
            if (!count)
              throw new PassportConnectorError(
                'InternalError',
                'The ACC inbox changed during delivery.',
              );
            expected.set(value, count - 1);
          }
          if ([...expected.values()].some((count) => count !== 0))
            throw new PassportConnectorError(
              'InternalError',
              'The ACC inbox lost a sealed delivery.',
            );
          const latestGrants = await flow.step('grant.roster', () =>
            ports.readGrants!.readActiveReadGrantTargets(record.address),
          );
          const targetKey = (targets: readonly { grantId: string; readPublicKey?: string }[]) =>
            targets.map(({ grantId, readPublicKey }) => `${grantId}:${readPublicKey ?? ''}`).sort();
          if (
            latestGrants.authNonce !== view.authNonce ||
            JSON.stringify(targetKey(latestGrants.targets)) !==
              JSON.stringify(targetKey(deliveries.targets))
          )
            throw new PassportConnectorError(
              'GrantRosterUnsettled',
              'The read-grant roster changed.',
            );
          const circuit = 'rotate_enc_key_with_p256';
          const challenge = pure.challenge_rotate_enc_key_with_p256(
            { bytes: fromHex(record.address) },
            p256(record.publicKey),
            keys.encKey,
            view.authNonce,
          );
          const signed = await flow.step('passkey.sign', () =>
            authoriser.authorise({
              account: record.address,
              circuit,
              args: [keys.encKey],
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
              keys.encKey,
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
          let rotatedView = await awaitSealedView(
            record,
            (candidate) =>
              candidate.authNonce > latestGrants.authNonce &&
              candidate.encKey !== undefined &&
              equalBytes(candidate.encKey, keys.encKey),
          );
          for (const entry of reencrypted)
            rotatedView = await appendP256(flow, record, entry!, rotatedView);
          onRotated?.({ encKey: keys.encKey, authNonce: rotatedView.authNonce });
          const rotation = {
            ...tx,
            droppedDeviceEntries: [],
            sealedReadGrants: deliveries.sealed.map(
              ({ grantId, readPublicKey, seal, sealedEncKey }) => ({
                grantId,
                readPublicKey,
                seal,
                sealedEncKey,
              }),
            ),
            unsealedGrantIds: deliveries.unsealedGrantIds,
          };
          if (!target) return rotation;
          const beforeRemoval = await read();
          if (
            !beforeRemoval.deviceEntries.some((entry) => equalBytes(entry, target)) ||
            !equalBytes(beforeRemoval.encKey, keys.encKey)
          )
            throw new PassportConnectorError(
              'DeviceRosterInvalid',
              'The removal target or ACC key changed.',
            );
          const removeCounter = await findCounter(flow, record, beforeRemoval);
          if (removeCounter === undefined) throw notHeld(record);
          const removeCircuit = 'remove_device_with_p256';
          const removeChallenge = pure.challenge_remove_device_with_p256!(
            { bytes: fromHex(record.address) },
            p256(record.publicKey),
            target,
            beforeRemoval.authNonce,
          );
          const removeSignature = await flow.step('passkey.sign', () =>
            authoriser.authorise({
              account: record.address,
              circuit: removeCircuit,
              args: [target],
              witnessValues: [],
              authNonce: beforeRemoval.authNonce,
              useCounter: removeCounter,
              challenge: removeChallenge,
              credentialId: record.credentialId,
            }),
          );
          if (
            removeSignature.scheme !== 'p256-webauthn' ||
            removeSignature.useCounter !== removeCounter ||
            removeSignature.pk.x !== record.publicKey.x ||
            removeSignature.pk.y !== record.publicKey.y
          )
            throw new PassportConnectorError(
              'NotAuthorised',
              'The signature names another device.',
            );
          flow.checkpoint();
          const removed = await (
            await chain()
          ).call({
            address: record.address,
            circuit: removeCircuit,
            args: [
              target,
              {
                pk: p256(record.publicKey),
                policy: record.policy,
                authenticator_data: removeSignature.authenticatorData,
                sig: removeSignature.sig,
                use_counter: removeCounter,
              },
            ],
            ...flow.ports,
          });
          for (let attempt = 0; attempt < 30; attempt++) {
            flow.checkpoint();
            const settled = await read();
            if (
              settled.authNonce > beforeRemoval.authNonce &&
              !settled.deviceEntries.some((entry) => equalBytes(entry, target))
            )
              return {
                ...rotation,
                ...removed,
                removedCommitmentHex: toHex(target),
                rotationTxHash: tx.txHash,
              };
            if (attempt < 29) await sleep(1000);
          }
          throw new PassportConnectorError(
            'DeviceRosterInvalid',
            'The removed device is still in the live ACC set.',
          );
        },
        target
          ? { kind: 'remove-device', account: record.address, commitmentHex: toHex(target) }
          : { kind: 'rotate-encryption-key', account: record.address },
      );
    });
}
