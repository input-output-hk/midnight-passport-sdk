import {
  createFileFundingStore,
  inspectFileFundingStore,
  releaseRejectedFundingReservation,
  verifyFundingCredit,
  verifyFundingRejection,
} from '@input-output-hk/mn-passport-service';
import { constants, fstatSync, openSync, readFileSync, closeSync } from 'node:fs';
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
const rejected = option('--release-rejected');
const nodeLogFile = option('--node-log');
const attribution = option('--attest-same-request');
const indexerUrl = option('--indexer-url') ?? 'http://127.0.0.1:18088/api/v4/graphql';
const indexerWsUrl = option('--indexer-ws-url') ?? 'ws://127.0.0.1:18088/api/v4/graphql/ws';
if (
  !file ||
  !requestId ||
  !operator ||
  [release, confirm, rejected].filter((value) => value === 'yes').length !== 1
)
  throw new Error(
    'pass --file PATH --request-id UUID --operator ID and exactly one reconciliation mode',
  );
if ((rejected === 'yes') !== (nodeLogFile !== undefined && attribution === 'yes'))
  throw new Error(
    'rejected local deposit requires a private node log and explicit request attribution',
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
  '--release-rejected',
  rejected,
  '--node-log',
  nodeLogFile,
  '--attest-same-request',
  attribution,
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
} else if (rejected === 'yes') {
  if (!nodeLogFile) throw new Error('node log is required');
  const fd = openSync(nodeLogFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  let nodeLog: string;
  try {
    const stat = fstatSync(fd);
    if (
      !stat.isFile() ||
      (stat.mode & 0o077) !== 0 ||
      stat.uid !== process.getuid?.() ||
      stat.size > 4 * 1024 * 1024
    )
      throw new Error('node log must be a bounded private file owned by the operator');
    nodeLog = readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
  const pending = (await fetch('http://127.0.0.1:9944', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'author_pendingExtrinsics', params: [] }),
    signal: AbortSignal.timeout(10_000),
  }).then((response) => response.json())) as unknown;
  if (
    !pending ||
    typeof pending !== 'object' ||
    !('result' in pending) ||
    !Array.isArray(pending.result) ||
    pending.result.length
  )
    throw new Error('node mempool is not confirmed empty');
  const actions = await accountActions(before.request.accountAddress, indexerUrl, indexerWsUrl);
  const evidence = verifyFundingRejection(before, actions, nodeLog);
  await releaseRejectedFundingReservation(file, requestId, operator, evidence);
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
