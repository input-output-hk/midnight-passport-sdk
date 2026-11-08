import { mutationDigest, mutationFailure, validateMutationDocument } from './mutation-codec.js';
import type { MutationJournal, MutationPins, MutationRunOptions } from './mutation-types.js';

function invocationId(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{32}$/.test(value))
    return mutationFailure('Mutation ID must be 16-byte lowercase hex.');
  return value;
}

/** Own invocation choices; keep the selected signal live and callback identity unchanged. */
export function mutationInvocation(options: MutationRunOptions): MutationRunOptions {
  const { id, signal, onEvent } = options;
  return Object.freeze({
    id: invocationId(id),
    ...(signal !== undefined && { signal }),
    ...(onEvent !== undefined && { onEvent }),
  });
}

/** Cancelled recovery requires the caller's explicit original boolean choice. */
export function admitResumeCancelled(value: unknown): boolean | undefined {
  if (value !== undefined && typeof value !== 'boolean')
    return mutationFailure('Cancelled mutation resumption must be an explicit boolean.');
  return value;
}

/** Admit the requested namespace before any approval, settlement or journal write. */
export async function loadMutationDocument(
  journal: MutationJournal,
  pins: MutationPins,
  id: string,
) {
  id = invocationId(id);
  const document = await journal.read(id);
  if (document) {
    validateMutationDocument(document);
    if (document.id !== id)
      return mutationFailure('Mutation document ID differs from the requested ID.');
    if (mutationDigest(document.pins) !== mutationDigest(pins))
      return mutationFailure('Mutation network, binding or arm differs.');
  }
  return document;
}
