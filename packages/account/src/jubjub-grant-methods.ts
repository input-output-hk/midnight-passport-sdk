/** Owner grant operations; keeps optional/live ports at their original use boundaries. */
import type {
  PassportAccount,
  ViewingKeyRotationResult,
  PassportGrantRevokeResult,
} from '@input-output-hk/mn-passport-protocol';
import type {
  PassportPorts,
  AccountViewingKey,
  Authoriser,
  AccBinding,
  Chain,
} from './ports/index.js';
import type { JubjubHint } from './jubjub-rotation-types.js';
import type { createJubjubViewingRotation } from './jubjub-viewing-rotation.js';
import { PassportConnectorError } from './errors.js';
import { snapshotGrantScope } from './request-snapshots.js';
import { requireGrantPure, requireRevokePure, requireRevokeAllPure } from './jubjub-binding.js';
import { issueAndPublishJubjubGrant } from './jubjub-grant-settlement.js';
import {
  recoverPendingJubjubGrants,
  type GrantRecoveryJournal,
} from './jubjub-grant-publication.js';
import { revokeAndConfirmJubjubGrant } from './jubjub-grant-revoke.js';
import { revokeAllJubjubGrants } from './jubjub-grant-revoke-all.js';
interface GrantContext {
  readonly ports: PassportPorts;
  readonly authoriser: Authoriser;
  readonly viewingKey: AccountViewingKey;
  readonly network: PassportPorts['network'];
  readonly networkId: string;
  readBinding(): Promise<AccBinding>;
  readChain(): Promise<Chain>;
  fresh(length: number): Uint8Array;
  readonly rotateViewingKey: ReturnType<typeof createJubjubViewingRotation>;
}
type Method = 'issueGrant' | 'revokeGrant' | 'revokeAllGrants' | 'recoverPendingGrants';
type Args<K extends Method> = Parameters<NonNullable<PassportAccount[K]>>;
export function jubjubGrantMethods(
  context: GrantContext,
  record: JubjubHint,
): Pick<PassportAccount, Method> {
  return {
    issueGrant: (scope, options) => issueGrant(context, record, scope, options),
    revokeGrant: (id, options) => revokeGrant(context, record, id, options),
    revokeAllGrants: (options) => revokeAllGrants(context, record, options),
    recoverPendingGrants: (options) => recoverPendingGrants(context, record, options),
  };
}
async function issueGrant(
  context: GrantContext,
  record: JubjubHint,
  scope: Args<'issueGrant'>[0],
  options: Args<'issueGrant'>[1] = {},
) {
  const {
    ports,
    network,
    networkId,
    viewingKey,
    readBinding,
    readChain,
    authoriser,
    fresh,
    rotateViewingKey,
  } = context;

  scope = snapshotGrantScope(scope);
  if (
    !ports.records ||
    !ports.grants ||
    !ports.grantCommitments ||
    !ports.grantJournal ||
    !ports.grantOrigin
  )
    throw new PassportConnectorError(
      'BindingUnsupported',
      'Grant issue needs local records, a live grant source, durable journal and host origin.',
    );
  if (
    scope.read &&
    (!ports.holdings ||
      !ports.readGrants ||
      !viewingKey.reencryptInbox ||
      !viewingKey.decodeDevicePublicKey ||
      !viewingKey.sealView)
  )
    throw new PassportConnectorError(
      'BindingUnsupported',
      'Read grants need verified holdings, live read grants and a full viewing-key port.',
    );
  if (network.bindingId !== 'acc-s3r1.1')
    throw new PassportConnectorError('BindingUnsupported', 'Unsupported ACC grant binding.');
  const pure = requireGrantPure((await readBinding()).pureCircuits);
  return issueAndPublishJubjubGrant(
    { hint: record, origin: ports.grantOrigin, scope, ...options },
    {
      bindingId: 'acc-s3r1.1',
      networkId,
      pure,
      chain: await readChain(),
      authoriser,
      records: ports.records,
      grants: ports.grants,
      commitments: ports.grantCommitments,
      journal: ports.grantJournal,
      viewingKey,
      random: fresh,
      ...(scope.read && {
        rotateBeforeIssue: () =>
          rotateViewingKey(
            record,
            options,
            undefined,
            undefined,
            undefined,
            undefined,
            false,
            true,
          ) as Promise<ViewingKeyRotationResult>,
      }),
    },
  );
}

async function revokeGrant(
  context: GrantContext,
  record: JubjubHint,
  grantId: Args<'revokeGrant'>[0],
  options: Args<'revokeGrant'>[1] = {},
) {
  const { ports, network, readBinding, readChain, authoriser, fresh, rotateViewingKey } = context;

  if (!ports.records || !ports.grantDetails)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'Grant revocation needs local records and live grant details.',
    );
  if (network.bindingId !== 'acc-s3r1.1')
    throw new PassportConnectorError('BindingUnsupported', 'Unsupported ACC grant binding.');
  const grant = await ports.grantDetails.readGrant(record.address, grantId);
  if (grant?.read && grant.active)
    return rotateViewingKey(
      record,
      options,
      undefined,
      undefined,
      undefined,
      grantId,
    ) as Promise<PassportGrantRevokeResult>;
  const pure = requireRevokePure((await readBinding()).pureCircuits);
  return revokeAndConfirmJubjubGrant(
    { hint: record, grantId, ...options },
    {
      bindingId: 'acc-s3r1.1',
      pure,
      chain: await readChain(),
      authoriser,
      records: ports.records,
      grants: ports.grantDetails,
      random: fresh,
    },
  );
}

async function revokeAllGrants(
  context: GrantContext,
  record: JubjubHint,
  options: Args<'revokeAllGrants'>[0] = {},
) {
  const {
    ports,
    network,
    readBinding,
    readChain,
    authoriser,
    fresh,
    viewingKey,
    rotateViewingKey,
  } = context;

  if (!ports.records || !ports.grantRoster)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'Grant revoke-all needs local records and the complete live grant roster.',
    );
  if (network.bindingId !== 'acc-s3r1.1')
    throw new PassportConnectorError('BindingUnsupported', 'Unsupported ACC grant binding.');
  const pure = requireRevokeAllPure((await readBinding()).pureCircuits);
  return revokeAllJubjubGrants(
    { hint: record, ...options },
    {
      bindingId: 'acc-s3r1.1',
      pure,
      chain: await readChain(),
      grants: ports.grantRoster,
      authoriser,
      records: ports.records,
      random: fresh,
      ...(ports.holdings &&
        ports.readGrants &&
        viewingKey.reencryptInbox &&
        viewingKey.decodeDevicePublicKey &&
        viewingKey.sealView && {
          rotateBeforeRevokeAll: () =>
            rotateViewingKey(
              record,
              options,
              undefined,
              undefined,
              undefined,
              undefined,
              true,
              true,
            ) as Promise<ViewingKeyRotationResult>,
        }),
    },
  );
}

async function recoverPendingGrants(
  context: GrantContext,
  record: JubjubHint,
  options: Args<'recoverPendingGrants'>[0] = {},
) {
  const { ports, network, networkId, readBinding, readChain, authoriser, fresh, viewingKey } =
    context;

  if (
    !ports.records ||
    !ports.grants ||
    !ports.grantCommitments ||
    !ports.grantJournal ||
    typeof (ports.grantJournal as Partial<GrantRecoveryJournal>).pending !== 'function'
  )
    throw new PassportConnectorError(
      'BindingUnsupported',
      'Grant recovery needs local records, a live roster and pending journal enumeration.',
    );
  if (network.bindingId !== 'acc-s3r1.1')
    throw new PassportConnectorError('BindingUnsupported', 'Unsupported ACC grant binding.');
  const pure = requireGrantPure((await readBinding()).pureCircuits);
  return recoverPendingJubjubGrants(
    { hint: record, ...options },
    {
      bindingId: 'acc-s3r1.1',
      networkId,
      pure,
      chain: await readChain(),
      grants: ports.grants,
      commitments: ports.grantCommitments,
      journal: ports.grantJournal as GrantRecoveryJournal,
      viewingKey,
      authoriser,
      records: ports.records,
      random: fresh,
    },
  );
}
