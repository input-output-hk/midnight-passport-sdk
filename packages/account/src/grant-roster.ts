import { PassportConnectorError } from './errors.js';
import { validGrantId } from './grant-publication-state.js';
import type { GrantRosterSource } from './ports/index.js';

export type GrantRoster = Awaited<ReturnType<GrantRosterSource['readGrantRoster']>>;

/** Check that a live ACC snapshot is complete enough to pin across an owner call. */
export function grantRosterFingerprint(roster: GrantRoster): string {
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
