import { z } from 'zod';
import {
  BackgroundError,
  createBackgroundClient,
  serveBackgroundTasks,
} from '@input-output-hk/mn-passport-account/background';
import { PassportConnectorError } from '@input-output-hk/mn-passport-account/errors';
import type { BackgroundPort, Prover } from '@input-output-hk/mn-passport-account/ports';
import type { ProvingProvider } from '@midnightntwrk/ledger-v9';
import { browserBackgroundPort, type BrowserMessageEndpoint } from './background.js';

const transactionBytes = z
  .instanceof(Uint8Array)
  .refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= 8 * 1024 * 1024)
  .refine((bytes) => bytes.buffer instanceof ArrayBuffer);
const proofScope = z.strictObject({
  networkId: z.string().regex(/^[a-z0-9-]{1,64}$/),
  bindingId: z.string().regex(/^[a-z0-9.-]{1,128}$/),
  circuits: z
    .array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,127}$/))
    .min(1)
    .max(128)
    .refine((names) => new Set(names).size === names.length),
});
const proofRequest = proofScope.extend({ tx: transactionBytes });
const readyMessage = z.strictObject({
  protocol: z.literal('passport-worker-prover-ready-v1'),
  channel: z.string().max(128),
});

/** WASM initialization can yield before the worker installs its message listener. */
function waitForWorker(port: BackgroundPort, channel: string): BackgroundPort {
  let ready = false;
  let queued: { message: unknown } | undefined;
  return {
    post(message) {
      if (ready) port.post(message);
      else queued = { message };
    },
    subscribe(receive, fail) {
      return port.subscribe((message) => {
        const marker = readyMessage.safeParse(message);
        if (!marker.success) {
          if (ready) receive(message);
          return;
        }
        if (marker.data.channel !== channel || ready) return;
        ready = true;
        if (!queued) return;
        const { message: request } = queued;
        queued = undefined;
        try {
          port.post(request);
        } catch {
          fail();
        }
      }, fail);
    },
    close() {
      queued = undefined;
      port.close();
    },
  };
}

export interface BrowserWorkerProver extends Prover {
  /** Terminate the owned worker and discard any pending proof. */
  close(): void;
}

function proofAborted() {
  return new PassportConnectorError('Aborted', 'Browser proof was cancelled.');
}

/** The worker is dedicated to this handle. A closed handle requires a fresh worker. */
export function createBrowserWorkerProver(
  worker: BrowserMessageEndpoint & { terminate(): void },
  options: { readonly channel: string; readonly timeoutMs?: number },
): BrowserWorkerProver {
  const port = browserBackgroundPort(worker, () => worker.terminate());
  const client = createBackgroundClient(waitForWorker(port, options.channel), {
    ...options,
    timeoutMs: options.timeoutMs ?? 600_000,
    maxPending: 1,
  });
  let busy = false;
  return {
    close: () => client.close(),
    async proveTx(unproven, { networkId, bindingId, circuits, signal }) {
      if (signal?.aborted) throw proofAborted();
      if (busy) throw new PassportConnectorError('ProverUnavailable', 'Browser prover is busy.');
      const admitted = proofRequest.safeParse({ networkId, bindingId, circuits, tx: unproven });
      if (!admitted.success)
        throw new PassportConnectorError('InternalError', 'Invalid browser proof request.');
      const tx = new Uint8Array(admitted.data.tx);
      const abort = () => client.close();
      busy = true;
      try {
        signal?.addEventListener('abort', abort);
        if (signal?.aborted) throw proofAborted();
        const result = await client.request('proveTx', { ...admitted.data, tx });
        if (signal?.aborted) throw proofAborted();
        const parsed = transactionBytes.safeParse(result);
        if (!parsed.success) {
          client.close();
          throw new BackgroundError('InvalidMessage');
        }
        return { tx: parsed.data, provenance: 'local' };
      } catch (error) {
        if (signal?.aborted) throw proofAborted();
        if (error instanceof BackgroundError && error.code === 'Timeout') client.close();
        throw new PassportConnectorError('ProverUnavailable', 'Browser proof did not complete.');
      } finally {
        tx.fill(0);
        busy = false;
        signal?.removeEventListener('abort', abort);
      }
    },
  };
}

export interface BrowserWorkerProverOptions {
  readonly channel: string;
  readonly networkId: string;
  readonly bindingId: string;
  readonly circuits: readonly string[];
  /** The host supplies a local engine and a source of verified proving artifacts. */
  readonly provider: ProvingProvider;
}

/** Run inside the worker. Only the proved transaction leaves this worker through the reply. */
export function serveBrowserWorkerProver(
  endpoint: BrowserMessageEndpoint & { close(): void },
  options: BrowserWorkerProverOptions,
): () => void {
  const { channel, provider } = options;
  const scope = proofScope.parse({
    networkId: options.networkId,
    bindingId: options.bindingId,
    circuits: options.circuits,
  });
  const allowed = new Set(scope.circuits);
  const port = browserBackgroundPort(endpoint, () => endpoint.close());
  const stop = serveBackgroundTasks(port, {
    channel,
    maxPending: 1,
    methods: {
      async proveTx(input) {
        const request = proofRequest.parse(input);
        try {
          if (
            request.networkId !== scope.networkId ||
            request.bindingId !== scope.bindingId ||
            request.circuits.some((circuit) => !allowed.has(circuit))
          )
            throw new Error('Proof scope mismatch.');
          const { proveWorkerTransaction } = await import('./ledger-worker-proof.js');
          return transactionBytes.parse(
            await proveWorkerTransaction(request.tx, request, provider),
          );
        } finally {
          request.tx.fill(0);
        }
      },
    },
  });
  try {
    port.post({ protocol: 'passport-worker-prover-ready-v1', channel });
  } catch {
    stop();
    throw new BackgroundError('Unavailable');
  }
  return stop;
}
