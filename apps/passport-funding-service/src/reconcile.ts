import {
  createFileFundingStore,
  inspectFileFundingStore,
} from '@input-output-hk/mn-passport-service';

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`);
  return value;
}

const file = option('--file');
const requestId = option('--request-id');
const operator = option('--operator');
const operation = option('--release-no-submit');
if (!file || !requestId || !operator || operation !== 'yes')
  throw new Error('pass --file PATH --request-id UUID --operator ID --release-no-submit yes');
const allowed = new Set([
  '--file',
  file,
  '--request-id',
  requestId,
  '--operator',
  operator,
  '--release-no-submit',
  operation,
]);
if (process.argv.slice(2).some((value) => !allowed.has(value)))
  throw new Error('unexpected argument');

const before = inspectFileFundingStore(file).entries.find(
  (entry) => entry.request.requestId === requestId,
);
if (!before || before.state !== 'pending' || before.noSubmit !== true)
  throw new Error('request is not pending with a durable no-submit marker');
await createFileFundingStore(file).releaseNoSubmit(requestId, operator);
const after = inspectFileFundingStore(file).entries.find(
  (entry) => entry.request.requestId === requestId,
);
console.log(JSON.stringify({ requestId, state: after?.state, release: after?.release }, null, 2));
