import { inspectFileFundingStore } from '@input-output-hk/mn-passport-service';

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  if (at < 0) return undefined;
  const value = process.argv[at + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}

const file = argument('--file');
if (!file) throw new Error('pass --file /path/to/funding-reservations.json');
const requestId = argument('--request-id');
if (requestId && !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(requestId))
  throw new Error('request ID must be a lowercase UUID');
const all = process.argv.includes('--all');
const allowed = new Set(['--file', file, '--request-id', requestId, '--all']);
if (process.argv.slice(2).some((value) => !allowed.has(value)))
  throw new Error('unexpected argument');

const inspection = inspectFileFundingStore(file);
const entries = inspection.entries.filter(
  (entry) =>
    (all || entry.state === 'pending') && (!requestId || entry.request.requestId === requestId),
);
if (requestId && entries.length === 0) throw new Error('request ID not found in selected view');
console.log(
  JSON.stringify(
    {
      lockPresent: inspection.lockPresent,
      pendingCount: inspection.entries.filter((entry) => entry.state === 'pending').length,
      entries,
      note: 'Read-only inspection. A pending request must not be retried with a new ID until wallet and ledger evidence is reconciled.',
    },
    null,
    2,
  ),
);
