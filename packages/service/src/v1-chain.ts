import { randomUUID } from 'node:crypto';
import type {
  PassportErrorCode,
  PassportEvent,
  PassportStep,
} from '@input-output-hk/mn-passport-protocol';
import type { ChainBackend } from './backend.js';
import type { DeploymentBudget } from './chain.js';
import { HttpError, json, readJson, type Route } from './http.js';
import type { JobStore } from './jobs.js';
import { serial } from './queue.js';

const TX_LIMIT = 8 * 1024 * 1024;
const DEPLOY_LIMIT = 4 * 1024;

export interface V1ChainRouteOptions {
  readonly jobs: JobStore;
  readonly deploymentBudget: DeploymentBudget;
  /** Share with legacy routes while the demo serves both APIs. */
  readonly runExclusive?: ReturnType<typeof serial>;
  readonly log?: (message: string) => void;
}

function record(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new HttpError(400, 'request body must be a JSON object');
  return body as Record<string, unknown>;
}

function bytes(value: unknown, name: string, length?: number): Uint8Array {
  if (typeof value !== 'string' || !/^(?:[0-9a-f]{2})+$/.test(value))
    throw new HttpError(400, `${name} must be non-empty lowercase hex`);
  const result = new Uint8Array(Buffer.from(value, 'hex'));
  if (length !== undefined && result.length !== length)
    throw new HttpError(400, `${name} must be ${length} bytes`);
  return result;
}

const hex = (value: Uint8Array): string => Buffer.from(value).toString('hex');

/**
 * The v1 proving, deployment and fee sponsor endpoints over the injected reference backend.
 * Long work is accepted as a job so an HTTP proxy need not hold a proof request open.
 */
export function v1ChainRoute(backend: ChainBackend, options: V1ChainRouteOptions): Route {
  const runExclusive = options.runExclusive ?? serial(8);
  const log = options.log ?? ((message: string) => console.error(message));

  const startJob = <Result>(
    step: PassportStep,
    code: PassportErrorCode,
    work: () => Promise<Result>,
  ) => {
    const flowId = randomUUID();
    const id = randomUUID();
    return options.jobs.start(
      async (emit) => {
        const started = Date.now();
        const event = (phase: PassportEvent['phase'], error?: PassportEvent['error']) =>
          emit({
            id,
            flowId,
            step,
            phase,
            at: Date.now(),
            clock: 'service',
            ...(phase === 'start' ? {} : { durationMs: Date.now() - started }),
            ...(error ? { error } : {}),
          });
        event('start');
        try {
          const result = await runExclusive(work);
          event('end');
          return result;
        } catch (cause) {
          event('error', { code, message: `${step} failed` });
          throw cause;
        }
      },
      (cause) => {
        log(
          `passport-service: /v1/${step} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        return { code, message: `${step} failed` };
      },
    );
  };

  return async (req, res, url) => {
    const path = url.pathname;
    if (
      req.method !== 'POST' ||
      !['/v1/prove-tx', '/v1/deploy', '/v1/sponsor/balance', '/v1/sponsor/submit'].includes(path)
    )
      return false;
    const body = record(await readJson(req, path === '/v1/deploy' ? DEPLOY_LIMIT : TX_LIMIT));

    if (path === '/v1/prove-tx') {
      const tx = bytes(body.tx, 'tx');
      json(
        res,
        202,
        startJob('prove', 'ProverUnavailable', async () => ({
          tx: hex(await backend.proveTx(tx)),
        })),
      );
      return true;
    }
    if (path === '/v1/deploy') {
      const boot = bytes(body.boot, 'boot', 32);
      const encKey = bytes(body.encKey, 'encKey', 32);
      if (typeof body.retireAuthority !== 'boolean')
        throw new HttpError(400, 'retireAuthority must be true or false');
      const firstArm = body.firstArm ?? 'p256';
      if (firstArm !== 'p256' && firstArm !== 'jubjub')
        throw new HttpError(400, 'firstArm must be p256 or jubjub');
      options.deploymentBudget.accept();
      json(
        res,
        202,
        startJob('deploy', 'SponsorRejected', async () => {
          const deployed = await backend.deploy(
            boot,
            encKey,
            body.retireAuthority as boolean,
            firstArm,
          );
          return { address: deployed.address, txIds: deployed.txHashes };
        }),
      );
      return true;
    }
    const tx = bytes(body.tx, 'tx');
    try {
      if (path === '/v1/sponsor/balance') {
        json(res, 200, { tx: hex(await backend.balance(tx)) });
      } else {
        json(res, 200, { txId: await backend.submit(tx) });
      }
    } catch (cause) {
      if (cause instanceof HttpError) throw cause;
      log(
        `passport-service: ${path} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
      throw new HttpError(502, 'sponsor failed');
    }
    return true;
  };
}
