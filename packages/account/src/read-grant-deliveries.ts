import type { FlowOptions } from '@input-output-hk/mn-passport-protocol';
import { toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import { startFlow } from './flow.js';
import { validGrantId } from './grant-publication-state.js';
import type {
  AccountKeyring,
  AccountViewingKey,
  ActiveReadGrantTarget,
  ActiveReadGrantTargetSource,
} from './ports/index.js';
export type {
  ActiveReadGrantSnapshot,
  ActiveReadGrantTarget,
  ActiveReadGrantTargetSource,
} from './ports/index.js';

export interface SealActiveReadGrantsInput extends FlowOptions {
  readonly networkId: string;
  /** The new keyring after rotation, or the current one when issuing a read grant. */
  readonly keyring: AccountKeyring;
  /** The ACC nonce of the ledger view whose grants are being sealed. */
  readonly authNonce: bigint;
  /** A newly issued or revoked grant to omit from resealing. */
  readonly exceptGrantId?: string;
}

export interface SealActiveReadGrantsPorts {
  readonly targets: ActiveReadGrantTargetSource;
  readonly viewingKey: AccountViewingKey;
  readonly random?: (length: number) => Uint8Array;
}

export interface ReadGrantDelivery {
  readonly grantId: string;
  readonly readPublicKey: string;
  readonly seal: Uint8Array;
  readonly entry: Uint8Array;
  readonly sealedEncKey: string;
}

export interface PreparedReadGrantDeliveries {
  /** The complete chain-backed snapshot used for sealing and later concurrency checks. */
  readonly targets: readonly ActiveReadGrantTarget[];
  readonly sealed: readonly ReadGrantDelivery[];
  readonly unsealedGrantIds: readonly string[];
}

const hex32 = (value: string): boolean => /^[0-9a-f]{64}$/.test(value);
const random = (length: number): Uint8Array =>
  (
    globalThis as unknown as { crypto: { getRandomValues(bytes: Uint8Array): Uint8Array } }
  ).crypto.getRandomValues(new Uint8Array(length));

/** Prepare validated view seals; the caller must durably stage and append returned entries. */
export async function sealActiveReadGrants(
  input: SealActiveReadGrantsInput,
  ports: SealActiveReadGrantsPorts,
): Promise<PreparedReadGrantDeliveries> {
  const flow = startFlow(input, ports.random ?? random);
  try {
    const { keyring, networkId, exceptGrantId } = input;
    if (
      !networkId ||
      !hex32(keyring.account) ||
      keyring.encKey.length !== 32 ||
      (exceptGrantId !== undefined && !validGrantId(exceptGrantId))
    )
      throw new PassportConnectorError(
        'GrantScopeInvalid',
        'Invalid read-grant keyring or exclusion.',
      );
    if (!ports.viewingKey.sealView)
      throw new PassportConnectorError(
        'BindingUnsupported',
        'The viewing key cannot seal read grants.',
      );
    const snapshot = await flow.step('grant.roster', () =>
      ports.targets.readActiveReadGrantTargets(keyring.account),
    );
    if (snapshot.authNonce !== input.authNonce)
      throw new PassportConnectorError('GrantRosterUnsettled', 'The read-grant roster is stale.');
    const targets = snapshot.targets;
    if (targets.length > 16)
      throw new PassportConnectorError('GrantLimitReached', 'Too many active read grants.');
    const seen = new Set<string>();
    for (const target of targets) {
      if (
        !validGrantId(target.grantId) ||
        seen.has(target.grantId) ||
        (target.readPublicKey !== undefined && !hex32(target.readPublicKey))
      )
        throw new PassportConnectorError('GrantScopeInvalid', 'Invalid active read-grant target.');
      seen.add(target.grantId);
    }
    const sealed: ReadGrantDelivery[] = [];
    const unsealedGrantIds: string[] = [];
    const sealedEncKey = toHex(keyring.encKey);
    for (const target of targets) {
      flow.checkpoint();
      if (target.grantId === exceptGrantId) continue;
      if (!target.readPublicKey) {
        unsealedGrantIds.push(target.grantId);
        continue;
      }
      const readPublicKey = target.readPublicKey;
      const delivery = await flow.step('grant.seal', async () => {
        try {
          return await ports.viewingKey.sealView!(networkId, keyring, {
            grantId: target.grantId,
            account: keyring.account,
            readPublicKey,
          });
        } catch {
          flow.checkpoint();
          return undefined;
        }
      });
      if (!delivery) {
        unsealedGrantIds.push(target.grantId);
        continue;
      }
      if (delivery.seal.length !== 94 || delivery.entry.length !== 192)
        throw new PassportConnectorError('InternalError', 'Invalid read-grant delivery size.');
      const opened = await ports.viewingKey.openInbox(networkId, keyring, [delivery.entry]);
      if (
        opened.length !== 1 ||
        opened[0]?.kind !== 'grant' ||
        opened[0].record.part !== 'view' ||
        opened[0].record.grantId !== target.grantId ||
        opened[0].record.encKeyPrefix !== sealedEncKey.slice(0, 6) ||
        opened[0].record.seal !== toHex(delivery.seal)
      )
        throw new PassportConnectorError('InternalError', 'Unrelated read-grant seal record.');
      sealed.push({ ...delivery, grantId: target.grantId, readPublicKey, sealedEncKey });
    }
    return { targets: targets.map((target) => ({ ...target })), sealed, unsealedGrantIds };
  } catch (error) {
    throw flow.fail(error);
  }
}
