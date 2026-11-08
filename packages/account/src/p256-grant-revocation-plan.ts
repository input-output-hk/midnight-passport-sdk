/** Admit live grant baselines and reconcile optional viewing-key rotation. */
import { PassportConnectorError } from './errors.js';
import { grantRosterFingerprint } from './grant-roster.js';
import type { GrantRoster } from './grant-roster.js';
import { validGrantId } from './grant-publication-state.js';
import { isSealedP256 } from './p256-device.js';
import { sameGrantKey } from './p256-grant-revocation-types.js';
import type {
  AllGrantRevocation,
  GrantRevocationOperation,
  GrantRotation,
  SingleGrantRevocation,
} from './p256-grant-revocation-types.js';
import type { AccLedgerView } from './ports/index.js';

/** Resolve the current source inside its Flow callback, retaining the host receiver. */
export function readP256Grant(operation: GrantRevocationOperation, grantId: string) {
  const source = operation.host.ports.grantDetails;
  if (!source) throw new TypeError("Cannot read properties of undefined (reading 'readGrant')");
  return source.readGrant(operation.record.address, grantId);
}

export function readP256GrantRoster(operation: GrantRevocationOperation) {
  const source = operation.host.ports.grantRoster;
  if (!source)
    throw new TypeError("Cannot read properties of undefined (reading 'readGrantRoster')");
  return source.readGrantRoster(operation.record.address);
}

function readTargets(operation: GrantRevocationOperation) {
  const source = operation.host.ports.readGrants;
  if (!source)
    throw new TypeError(
      "Cannot read properties of undefined (reading 'readActiveReadGrantTargets')",
    );
  return source.readActiveReadGrantTargets(operation.record.address);
}

async function rotateForSingleGrant(
  operation: GrantRevocationOperation,
  grantId: string,
  before: AccLedgerView,
): Promise<GrantRotation> {
  const { host, record, flow, options } = operation;
  if (!isSealedP256(record) || !host.ports.holdings || !host.ports.readGrants)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'Read-grant revoke needs sealed keys, verified holdings and live read targets.',
    );
  const targets = await flow.step('grant.roster', () => readTargets(operation));
  if (
    targets.authNonce !== before.authNonce ||
    !targets.targets.some(({ grantId: id }) => id === grantId)
  )
    throw new PassportConnectorError(
      'GrantRosterUnsettled',
      'The read grant is absent from the live targets.',
    );
  let rotated: GrantRotation['rotated'];
  const rotation = await host.rotate(record, options, undefined, grantId, (state) => {
    rotated = state;
  });
  return { rotation, rotated };
}

function checkRotatedView(view: AccLedgerView, rotated: GrantRotation['rotated']) {
  if (
    !rotated ||
    view.authNonce !== rotated.authNonce ||
    !view.encKey ||
    !sameGrantKey(view.encKey, rotated.encKey)
  )
    throw new PassportConnectorError(
      'GrantRosterUnsettled',
      'The ACC key changed after read-grant rotation.',
    );
}

export async function prepareSingleGrantRevocation(
  operation: GrantRevocationOperation,
  grantId: string,
): Promise<SingleGrantRevocation> {
  const { host, record, flow } = operation;
  const pure = (await host.binding()).pureCircuits;
  if (
    host.network.bindingId !== 'acc-s3r1.1' ||
    !host.ports.grantDetails ||
    !pure.challenge_revoke_grant_with_p256
  )
    throw new PassportConnectorError(
      'BindingUnsupported',
      'P-256 revoke needs the pinned grant binding and live grant details.',
    );
  if (!validGrantId(grantId))
    throw new PassportConnectorError('GrantScopeInvalid', 'The grant id must be 32-byte hex.');
  let grant = await flow.step('grant.roster', () => readP256Grant(operation, grantId));
  if (!grant) throw new PassportConnectorError('GrantNotFound', 'The grant is missing.');
  if (!grant.active)
    throw new PassportConnectorError('GrantRevoked', 'The grant is already revoked.');
  let view = await host.readView(flow, record);
  if (!view.booted || record.status !== 'active' || view.specVersion !== 3)
    throw new PassportConnectorError('AccountNotFound', 'The active spec-3 ACC is missing.');
  if (grant.authNonce !== view.authNonce)
    throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster is stale.');
  let rotation: GrantRotation = { rotation: undefined, rotated: undefined };
  if (grant.read) {
    rotation = await rotateForSingleGrant(operation, grantId, view);
    view = await host.readView(flow, record);
    checkRotatedView(view, rotation.rotated);
    grant = await flow.step('grant.roster', () => readP256Grant(operation, grantId));
    if (!grant?.active || !grant.read || grant.authNonce !== view.authNonce)
      throw new PassportConnectorError(
        'GrantRosterUnsettled',
        'The read grant changed during viewing-key rotation.',
      );
  }
  return { pure, grantId, grant, view, ...rotation };
}

async function rotateForAllGrants(
  operation: GrantRevocationOperation,
  roster: GrantRoster,
  baseline: string,
  activeReadIds: readonly string[],
): Promise<GrantRotation & { readonly roster: GrantRoster }> {
  const { host, record, flow, options } = operation;
  if (!isSealedP256(record) || !host.ports.readGrants || !host.ports.holdings)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'Read-grant revoke-all needs sealed keys, verified holdings and live read targets.',
    );
  const targets = await flow.step('grant.roster', () => readTargets(operation));
  if (
    targets.authNonce !== roster.authNonce ||
    JSON.stringify(targets.targets.map(({ grantId }) => grantId).sort()) !==
      JSON.stringify(activeReadIds)
  )
    throw new PassportConnectorError(
      'GrantRosterUnsettled',
      'The active read-grant targets differ from the ACC grant map.',
    );
  let rotated: GrantRotation['rotated'];
  const rotation = await host.rotate(record, options, undefined, 'all', (state) => {
    rotated = state;
  });
  const advanced = await flow.step('grant.roster', () => readP256GrantRoster(operation));
  if (
    advanced.authNonce <= roster.authNonce ||
    advanced.generation !== roster.generation ||
    grantRosterFingerprint(advanced) !== baseline
  )
    throw new PassportConnectorError(
      'GrantRosterUnsettled',
      'The grant map changed during viewing-key rotation.',
    );
  return { rotation, rotated, roster: advanced };
}

export async function prepareAllGrantRevocation(
  operation: GrantRevocationOperation,
): Promise<AllGrantRevocation> {
  const { host, record, flow } = operation;
  if (host.network.bindingId !== 'acc-s3r1.1' || !host.ports.grantRoster)
    throw new PassportConnectorError(
      'BindingUnsupported',
      'P-256 revoke-all needs the pinned grants binding and a complete live grant roster.',
    );
  let roster = await flow.step('grant.roster', () => readP256GrantRoster(operation));
  const baseline = grantRosterFingerprint(roster);
  const activeReadIds = roster.entries
    .filter(({ active, read }) => active && read)
    .map(({ id }) => id)
    .sort();
  let rotation: GrantRotation = { rotation: undefined, rotated: undefined };
  if (activeReadIds.length) {
    const advanced = await rotateForAllGrants(operation, roster, baseline, activeReadIds);
    rotation = { rotation: advanced.rotation, rotated: advanced.rotated };
    roster = advanced.roster;
  }
  const view = await host.readView(flow, record);
  if (!view.booted || view.specVersion !== 3)
    throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
  if (view.authNonce !== roster.authNonce)
    throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster is stale.');
  if (rotation.rotated) checkRotatedView(view, rotation.rotated);
  return { roster, baseline, view, ...rotation };
}
