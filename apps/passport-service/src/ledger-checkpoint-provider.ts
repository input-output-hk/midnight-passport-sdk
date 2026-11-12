import { Worker } from 'node:worker_threads';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  checkpointHash,
  ledgerCheckpointJob,
  ledgerCheckpointConfig,
  type LedgerCheckpointJob,
} from './ledger-checkpoint-config.ts';

const advanceResult = z.object({
  height: z.number().int().nonnegative(),
  blockHash: checkpointHash,
  finalizedHeight: z.number().int().nonnegative(),
});

/**
 * Opt-in Node host provider. Give one provider ownership of its cache directory.
 * Advance on a host-managed background schedule. Busy or cancelled reads fail
 * closed, and advance never queues behind the request path.
 */
export function createLedgerCheckpointProvider(options: z.input<typeof ledgerCheckpointConfig>) {
  const config = ledgerCheckpointConfig.parse({
    ...options,
    directory: resolve(options.directory),
  });
  let active = false;

  async function run(job: LedgerCheckpointJob, signal: AbortSignal): Promise<unknown> {
    if (active || signal.aborted) return undefined;
    active = true;
    let worker: Worker | undefined;
    try {
      worker = new Worker(new URL('./ledger-checkpoint-worker.mjs', import.meta.url), {
        workerData: { config, job },
        execArgv: [],
      });
      const thread = worker;
      return await new Promise<unknown>((finish) => {
        const settle = (value?: unknown) => {
          signal.removeEventListener('abort', abort);
          finish(value);
        };
        const abort = () => settle();
        signal.addEventListener('abort', abort, { once: true });
        thread.once('message', (value: unknown) => settle(signal.aborted ? undefined : value));
        thread.once('error', abort);
        thread.once('exit', abort);
        if (signal.aborted) abort();
      });
    } catch {
      return undefined;
    } finally {
      try {
        await worker?.terminate();
      } finally {
        active = false;
      }
    }
  }

  return {
    async advanceFinalized(signal: AbortSignal, throughHeight?: number) {
      const job = ledgerCheckpointJob.safeParse({ kind: 'advance', throughHeight });
      if (!job.success) return undefined;
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
      const result = advanceResult.safeParse(await run(job.data, bounded));
      return result.success && !bounded.aborted ? result.data : undefined;
    },
    async readLedgerSnapshot(blockHash: string, signal: AbortSignal) {
      const hash = checkpointHash.safeParse(blockHash);
      if (!hash.success) return undefined;
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(4_000)]);
      const result = await run({ kind: 'read', blockHash: hash.data }, bounded);
      return !bounded.aborted && result instanceof Uint8Array ? result : undefined;
    },
  };
}
