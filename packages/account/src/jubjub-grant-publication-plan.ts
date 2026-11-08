import { fromHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import type { Flow } from './flow.js';
import { verifyStagedGrantCommitment } from './grant-opening-check.js';
import {
  isPublishableReadGrant,
  isPublishableUnshieldedGrant,
  validGrantId,
} from './grant-publication-state.js';
import type { StagedJubjubGrant } from './jubjub-grant-issue.js';
import type {
  PublishJubjubGrantInput,
  PublishJubjubGrantPorts,
} from './jubjub-grant-publication.js';
import {
  publicationBytesEqual,
  publicationPointEqual,
  type ApprovedPublication,
  type PublicationHint,
  type PublicationOperation,
  type PublicationPorts,
  type PublicationView,
  type SelectedPublication,
} from './jubjub-grant-publication-types.js';
import type { AccLedgerView } from './ports/index.js';

const canonicalScope = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalScope).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalScope(item)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};
const isActiveHint = (hint: PublishJubjubGrantInput['hint']): hint is PublicationHint =>
  hint.scheme === 'jubjub-schnorr' && hint.status === 'active' && !!hint.credentialId;
const hasOwnerSession = (ports: PublishJubjubGrantPorts): ports is PublicationPorts =>
  ports.authoriser.scheme === 'jubjub-schnorr' && !!ports.authoriser.withKeySession;
const hasInbox = (view: AccLedgerView): view is PublicationView =>
  view.encKey?.length === 32 && !!view.inboxEntries;

export function requirePublicationView(view: AccLedgerView | undefined): PublicationView {
  if (!view?.booted)
    throw new PassportConnectorError('AccountNotFound', 'The active ACC is missing.');
  if (view.specVersion !== 3)
    throw new PassportConnectorError('BindingUnsupported', 'The ACC spec version is not 3.');
  if (!hasInbox(view))
    throw new PassportConnectorError(
      'BindingUnsupported',
      'The ACC inbox and encryption key are required.',
    );
  return view;
}

function requireOpening(
  opening: StagedJubjubGrant | undefined,
  operation: PublicationOperation,
): StagedJubjubGrant {
  const { hint, grantId } = operation;
  if (
    !isPublishableUnshieldedGrant(opening, hint.address, grantId) &&
    !isPublishableReadGrant(opening, hint.address, grantId)
  )
    throw new PassportConnectorError(
      'GrantScopeInvalid',
      'No supported staged grant opening exists.',
    );
  return opening;
}

export async function requireActivePublicationGrant(
  operation: PublicationOperation,
  opening: StagedJubjubGrant,
  view: PublicationView,
): Promise<void> {
  const { ports, flow, hint, grantId } = operation;
  const live = await flow.step('grant.roster', () =>
    ports.commitments.readGrantCommitment(hint.address, grantId),
  );
  verifyStagedGrantCommitment(opening, live, ports.pure);
  if (live?.authNonce !== view.authNonce)
    throw new PassportConnectorError('GrantRosterUnsettled', 'The grant roster is stale.');
}

async function awaitActiveGrant(
  operation: Pick<
    PublicationOperation,
    'ports' | 'flow' | 'hint' | 'grantId' | 'attempts' | 'wait'
  >,
): Promise<void> {
  const { ports, flow, hint, grantId, attempts, wait } = operation;
  await flow.step('grant.roster', async () => {
    for (let attempt = 0; attempt < attempts; attempt++) {
      flow.checkpoint();
      if ((await ports.grants.readActiveGrantIds(hint.address)).includes(grantId)) return;
      if (attempt + 1 < attempts) await wait(1000);
    }
    throw new PassportConnectorError(
      'GrantRosterUnsettled',
      'The submitted grant did not appear active on chain.',
    );
  });
}

export async function prepareJubjubPublication(
  input: PublishJubjubGrantInput,
  ports: PublishJubjubGrantPorts,
  flow: Flow,
  wait: (milliseconds: number) => Promise<void>,
  attempts: number,
): Promise<ApprovedPublication> {
  const { hint, grantId } = input;
  if (!validGrantId(grantId) || !isActiveHint(hint))
    throw new PassportConnectorError(
      'NotAuthorised',
      'An active JubJub grant and device are required.',
    );
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 120)
    throw new PassportConnectorError('InternalError', 'Invalid grant settlement polling bound.');
  const credentialId = hint.credentialId;
  if (!(await ports.records.exists()))
    throw new PassportConnectorError('AccountNotFound', 'No local account record exists.');
  if (!hasOwnerSession(ports))
    throw new PassportConnectorError('BindingUnsupported', 'A JubJub key session is required.');
  // Preserve the original self/random-array construction point after the first ledger read.
  await awaitActiveGrant({ ports, flow, hint, grantId, attempts, wait });
  const view = requirePublicationView(
    await flow.step('chain.read', () =>
      ports.chain.readAccount(hint.address, { includeInbox: true, includeDevices: true }),
    ),
  );
  const operation: PublicationOperation = {
    ports,
    flow,
    hint,
    credentialId,
    grantId,
    attempts,
    wait,
    self: { bytes: fromHex(hint.address) },
    appendTxHashes: [],
  };
  const opening = requireOpening(
    await flow.step('grant.stage', () => ports.journal.load(hint.address, grantId)),
    operation,
  );
  await requireActivePublicationGrant(operation, opening, view);
  const scope: typeof opening.scope = JSON.parse(JSON.stringify(opening.scope));
  const approved = {
    scope,
    scopeDigest: opening.scopeDigest,
    scopeSalt: opening.bookkeeping.scopeSalt,
    slot: opening.bookkeeping.slot,
  };
  return { operation, view, opening, approved };
}

export async function selectJubjubPublication(
  prepared: ApprovedPublication,
): Promise<SelectedPublication> {
  const { operation, approved, view } = prepared;
  const { ports, hint, grantId, credentialId } = operation;
  const record = await ports.records.read();
  if (
    record?.scheme !== 'jubjub-schnorr' ||
    record.address !== hint.address ||
    record.bindingId !== ports.bindingId ||
    !record.credentialId ||
    !publicationBytesEqual(credentialId, record.credentialId)
  )
    throw new PassportConnectorError(
      'NotAuthorised',
      'The stored account does not match this device.',
    );
  const staged = requireOpening(await ports.journal.load(hint.address, grantId), operation);
  if (
    staged.scopeDigest !== approved.scopeDigest ||
    staged.bookkeeping.scopeSalt !== approved.scopeSalt ||
    staged.bookkeeping.slot !== approved.slot ||
    canonicalScope(staged.scope) !== canonicalScope(approved.scope)
  )
    throw new PassportConnectorError(
      'GrantScopeInvalid',
      'The staged grant changed after consent.',
    );
  await requireActivePublicationGrant(operation, staged, view);
  const publicKey = await ports.authoriser.devicePublicKey();
  if (!publicationPointEqual(publicKey, hint.publicKey))
    throw new PassportConnectorError('NotAuthorised', 'The selected device does not own this ACC.');
  return { operation, record, staged, publicKey };
}
