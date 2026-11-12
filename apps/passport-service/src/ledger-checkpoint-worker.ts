import { parentPort, workerData } from 'node:worker_threads';
import { z } from 'zod';
import { ledgerCheckpointConfig, ledgerCheckpointJob } from './ledger-checkpoint-config.ts';
import { runLedgerCheckpointJob } from './ledger-checkpoint-replay.ts';

const input = z.object({ config: ledgerCheckpointConfig, job: ledgerCheckpointJob });
if (!parentPort) throw new Error('Missing ledger checkpoint worker port.');
const { config, job } = input.parse(workerData);
try {
  const result = await runLedgerCheckpointJob(config, job, new AbortController().signal);
  parentPort.postMessage(result);
} catch {
  parentPort.postMessage(undefined);
}
