import { fromHex, toHex } from './codec.js';
import { PassportConnectorError } from './errors.js';
import {
  grantObjectMatches,
  publishedGrantParts,
  publishedGrantView,
} from './grant-publication-state.js';
import { appendJubjubPublicationEntry } from './jubjub-grant-publication-append.js';
import { requireActivePublicationGrant } from './jubjub-grant-publication-plan.js';
import {
  isReadPublication,
  type PublicationProgress,
  type PublicationView,
  type SelectedPublication,
} from './jubjub-grant-publication-types.js';
import type { AccountViewingKey } from './ports/index.js';
import type { PublishedJubjubGrant } from './jubjub-grant-publication.js';

const hasReadSealing = (
  ports: SelectedPublication['operation']['ports'],
): ports is SelectedPublication['operation']['ports'] & {
  readonly viewingKey: AccountViewingKey & { sealView: NonNullable<AccountViewingKey['sealView']> };
} => !!ports.viewingKey.sealView;

const hasBookkeepingPair = (
  sealed: readonly Uint8Array[],
): sealed is readonly [Uint8Array, Uint8Array] =>
  sealed.length === 2 &&
  sealed[0] !== undefined &&
  sealed[1] !== undefined &&
  sealed.every((entry) => entry.length === 192);

const keyring = (selected: SelectedPublication, view: PublicationView) => ({
  account: selected.operation.hint.address,
  encKey: view.encKey,
  envelopes: [...view.inboxEntries].reverse(),
});
const openPublicationInbox = (selected: SelectedPublication, view: PublicationView) =>
  selected.operation.ports.viewingKey.openInbox(
    selected.operation.ports.networkId,
    keyring(selected, view),
    view.inboxEntries,
  );

export async function inspectJubjubPublication(
  selected: SelectedPublication,
  view: PublicationView,
): Promise<PublicationProgress> {
  const opened = await openPublicationInbox(selected, view);
  const readOpening = isReadPublication(selected.staged) ? selected.staged : undefined;
  return {
    view,
    parts: publishedGrantParts(opened, selected.staged.bookkeeping),
    readOpening,
    viewRecord: readOpening
      ? publishedGrantView(opened, selected.operation.grantId, toHex(view.encKey))
      : undefined,
  };
}

async function sealBookkeepingParts(selected: SelectedPublication, progress: PublicationProgress) {
  const { ports, hint, grantId } = selected.operation;
  const { staged } = selected;
  const sealed = await ports.viewingKey.sealGrant(
    ports.networkId,
    hint.address,
    staged.bookkeeping,
  );
  // Missing required seals used to reach a signature with an undefined entry.
  if (!hasBookkeepingPair(sealed))
    throw new PassportConnectorError('InternalError', 'Viewing key returned invalid grant seals.');
  const opened = await ports.viewingKey.openInbox(
    ports.networkId,
    keyring(selected, progress.view),
    sealed,
  );
  if (
    opened[0]?.kind !== 'grant' ||
    opened[0].record.part !== 'grant' ||
    opened[0].record.grantId !== grantId ||
    opened[0].record.scopeSalt !== staged.bookkeeping.scopeSalt ||
    opened[1]?.kind !== 'grant' ||
    opened[1].record.part !== 'object' ||
    opened[1].record.grantId !== grantId ||
    !grantObjectMatches(opened[1].record.object, staged.bookkeeping.object)
  )
    throw new PassportConnectorError(
      'InternalError',
      'Viewing key returned unrelated grant seals.',
    );
  return sealed;
}

export async function publishMissingJubjubBookkeeping(
  selected: SelectedPublication,
  progress: PublicationProgress,
): Promise<PublicationProgress> {
  if (progress.parts.header && progress.parts.object) return progress;
  const { operation } = selected;
  const sealed = await sealBookkeepingParts(selected, progress);
  for (const [index, part] of [
    [0, 'header'],
    [1, 'object'],
  ] as const) {
    if (progress.parts[part]) continue;
    operation.flow.checkpoint();
    await requireActivePublicationGrant(operation, selected.staged, progress.view);
    const entry = sealed[index];
    const view = await appendJubjubPublicationEntry(
      selected,
      progress.view,
      () => entry,
      'The accepted grant bookkeeping append did not appear on chain.',
    );
    const opened = await openPublicationInbox(selected, view);
    progress = {
      ...progress,
      view,
      parts: publishedGrantParts(opened, selected.staged.bookkeeping),
    };
    if (!progress.parts[part])
      throw new PassportConnectorError(
        'GrantBookkeepingUnsettled',
        'The ACC inbox does not open the appended grant bookkeeping.',
      );
  }
  if (!progress.parts.header || !progress.parts.object)
    throw new PassportConnectorError(
      'GrantBookkeepingUnsettled',
      'The ACC inbox lacks part of the staged grant opening.',
    );
  return progress;
}

export async function publishJubjubReadDelivery(
  selected: SelectedPublication,
  progress: PublicationProgress,
): Promise<PublicationProgress> {
  const { staged, operation } = selected;
  if (!isReadPublication(staged) || progress.viewRecord) return progress;
  const { ports, flow, hint, grantId } = operation;
  if (!hasReadSealing(ports))
    throw new PassportConnectorError('BindingUnsupported', 'Read-grant sealing is unavailable.');
  const readPublicKey = staged.bookkeeping.readPublicKey;
  const ring = keyring(selected, progress.view);
  const delivery = await flow.step('grant.seal', () =>
    ports.viewingKey.sealView(ports.networkId, ring, {
      grantId,
      account: hint.address,
      readPublicKey,
    }),
  );
  if (delivery.seal.length !== 94 || delivery.entry.length !== 192)
    throw new PassportConnectorError('InternalError', 'Invalid read-grant seal.');
  const verified = await ports.viewingKey.openInbox(ports.networkId, ring, [delivery.entry]);
  if (
    verified[0]?.kind !== 'grant' ||
    verified[0].record.part !== 'view' ||
    verified[0].record.grantId !== grantId ||
    verified[0].record.encKeyPrefix !== toHex(progress.view.encKey).slice(0, 6) ||
    verified[0].record.seal !== toHex(delivery.seal)
  )
    throw new PassportConnectorError('InternalError', 'Unrelated read-grant seal.');
  const view = await appendJubjubPublicationEntry(
    selected,
    progress.view,
    () => delivery.entry,
    'The read-grant seal did not appear on chain.',
  );
  const viewRecord = publishedGrantView(
    await openPublicationInbox(selected, view),
    grantId,
    toHex(view.encKey),
  );
  if (!viewRecord || viewRecord.seal !== toHex(delivery.seal))
    throw new PassportConnectorError(
      'GrantBookkeepingUnsettled',
      'The ACC inbox does not open the read-grant seal.',
    );
  return { ...progress, view, viewRecord };
}

/** The caller distinguishes the existing-inbox no-op from the path that advanced local state. */
export async function finishJubjubPublication(
  selected: SelectedPublication,
  progress: PublicationProgress,
): Promise<PublishedJubjubGrant> {
  const { operation } = selected;
  const { ports, hint, grantId, appendTxHashes } = operation;
  await requireActivePublicationGrant(operation, selected.staged, progress.view);
  await ports.journal.markPublished(hint.address, grantId);
  return publicationResult(selected, progress, selected.record.localUseCounter, appendTxHashes);
}

export async function finishAppendedJubjubPublication(
  selected: SelectedPublication,
  progress: PublicationProgress,
): Promise<PublishedJubjubGrant> {
  const { operation, record } = selected;
  const { ports, hint, grantId, appendTxHashes } = operation;
  await requireActivePublicationGrant(operation, selected.staged, progress.view);
  await ports.journal.markPublished(hint.address, grantId);
  const current = (await ports.records.read()) ?? record;
  return publicationResult(selected, progress, current.localUseCounter, appendTxHashes);
}

function publicationResult(
  selected: SelectedPublication,
  progress: PublicationProgress,
  nextUseCounter: bigint,
  appendTxHashes: readonly string[],
): PublishedJubjubGrant {
  const { grantId } = selected.operation;
  const { viewRecord, readOpening, view } = progress;
  return {
    grantId,
    status: 'active',
    appendTxHashes,
    nextUseCounter,
    ...(viewRecord &&
      readOpening && {
        sealedReadGrant: {
          grantId,
          readPublicKey: readOpening.bookkeeping.readPublicKey,
          seal: fromHex(viewRecord.seal),
          sealedEncKey: toHex(view.encKey),
        },
      }),
  };
}
