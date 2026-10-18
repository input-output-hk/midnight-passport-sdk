import {
  createFileFundingStore,
  inspectFileFundingStore,
  verifyFundingCredit,
} from '@input-output-hk/mn-passport-service';
import { accountActions } from './indexer-reconciliation.ts';

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
const release = option('--release-no-submit');
const confirm = option('--confirm-credit');
const indexerUrl = option('--indexer-url') ?? 'http://127.0.0.1:18088/api/v4/graphql';
const indexerWsUrl = option('--indexer-ws-url') ?? 'ws://127.0.0.1:18088/api/v4/graphql/ws';
if (!file || !requestId || !operator || (release === 'yes') === (confirm === 'yes'))
  throw new Error(
    'pass --file PATH --request-id UUID --operator ID and exactly one of --release-no-submit yes or --confirm-credit yes',
  );
for (const [raw, protocols] of [
  [indexerUrl, ['http:', 'https:']],
  [indexerWsUrl, ['ws:', 'wss:']],
] as const) {
  const url = new URL(raw);
  if (
    !protocols.some((protocol) => url.protocol === protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  )
    throw new Error('reconciliation indexer must be a loopback endpoint');
}
const allowed = new Set([
  '--file',
  file,
  '--request-id',
  requestId,
  '--operator',
  operator,
  '--release-no-submit',
  release,
  '--confirm-credit',
  confirm,
  '--indexer-url',
  indexerUrl,
  '--indexer-ws-url',
  indexerWsUrl,
]);
if (process.argv.slice(2).some((value) => !allowed.has(value)))
  throw new Error('unexpected argument');

const before = inspectFileFundingStore(file).entries.find(
  (entry) => entry.request.requestId === requestId,
);
if (!before || before.state !== 'pending') throw new Error('request is not pending');
if (before.request.networkId !== 'undeployed')
  throw new Error('this reconciliation command is qualified only for undeployed localnet');
const store = createFileFundingStore(file);
if (release === 'yes') {
  if (before.noSubmit !== true) throw new Error('request has no durable no-submit marker');
  await store.releaseNoSubmit(requestId, operator);
} else {
  const actions = await accountActions(before.request.accountAddress, indexerUrl, indexerWsUrl);
  const verified = verifyFundingCredit(before, actions);
  await store.completeReconciled(requestId, operator, verified.result, verified.evidence);
}
const after = inspectFileFundingStore(file).entries.find(
  (entry) => entry.request.requestId === requestId,
);
console.log(
  JSON.stringify(
    {
      requestId,
      state: after?.state,
      ...(after?.release && { release: after.release }),
      ...(after?.result && { result: after.result }),
      ...(after?.reconciliation && { reconciliation: after.reconciliation }),
    },
    null,
    2,
  ),
);
