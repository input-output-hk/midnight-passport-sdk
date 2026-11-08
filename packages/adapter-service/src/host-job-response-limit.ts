/** The service emits compact JSON. Derive its wire budget from the largest admitted public
 * envelope: 256 events, safe-integer cursors/times and 64 distinct tagged watch identifiers.
 * Whitespace counts toward this limit; it is not an unbounded formatting allowance.
 */
function maximumSnapshotBytes(): number {
  const largest = Number.MAX_SAFE_INTEGER;
  const events = Array.from({ length: 256 }, (_, index) => ({
    sequence: largest - 255 + index,
    state: index === 255 ? 'done' : 'unknown',
    at: largest,
    preparedSteps: 64,
    confirmedSteps: 64,
  }));
  const common = {
    jobId: 'f'.repeat(32),
    identitySha256: 'f'.repeat(64),
    milestones: { preparedSteps: 64, confirmedSteps: 64 },
    events,
    cursor: String(largest),
    firstCursor: String(largest - 256),
  };
  const done = {
    ...common,
    state: 'done',
    outcome: {
      kind: 'confirmed',
      digest: 'f'.repeat(64),
      result: {
        address: 'f'.repeat(64),
        txIds: Array.from({ length: 64 }, (_, index) => index.toString(16).padStart(66, '0')),
      },
    },
  };
  const unknown = {
    ...common,
    state: 'unknown',
    events: events.map((event) => ({ ...event, state: 'unknown' })),
    error: {
      code: 'MutationUnsettled',
      message: 'Host job is unsettled; retain the original identity and reconcile.',
    },
  };
  const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
  return Math.max(size(done), size(unknown));
}
export const HOST_JOB_RESPONSE_BYTES_LIMIT = maximumSnapshotBytes();
