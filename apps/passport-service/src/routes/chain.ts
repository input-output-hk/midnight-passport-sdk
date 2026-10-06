import type { ChainBackend } from '../backend.ts';
import { HttpError, json, readJson, type Route } from '../http.ts';
import { serial } from '../queue.ts';

/**
 * Body limits. A proving preimage carries the circuit's private inputs, so it can be large; the
 * 8 MiB of hex that `readJson` allows by default is 4 MiB of preimage, which is ample. A
 * transaction is bounded by the ledger's block limits (tens of kilobytes; the largest, a wave
 * maintenance update, carries about 15 kB of verifier keys), so the same 8 MiB of hex covers it
 * with a wide margin and no larger limit is needed. `/deploy` carries two 32-byte values only.
 */
const PREIMAGE_LIMIT = 8 * 1024 * 1024;
const TX_LIMIT = 8 * 1024 * 1024;
const DEPLOY_LIMIT = 4 * 1024;
/** A decimal digit string this long already exceeds any field element the proof server takes. */
const MAX_BINDING_DIGITS = 80;
/** Jobs allowed to wait behind the running one (a proof or a deployment). */
const DEFAULT_MAX_QUEUED = 8;

export interface ChainRouteOptions {
  /** The circuits of the binding (artefacts.ts); /check and /prove refuse any other. */
  readonly circuits: ReadonlySet<string>;
  /** /deploy requests accepted over the process's life, failures included. */
  readonly maxDeploys: number;
  readonly maxQueued?: number;
  /** Receives backend failures, which are logged here and not all returned to the client. */
  readonly log?: (message: string) => void;
}

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

const bytes = (s: unknown, field: string): Uint8Array => {
  if (typeof s !== 'string' || s.length === 0 || !/^([0-9a-f]{2})+$/.test(s)) {
    throw new HttpError(400, `${field} must be non-empty lowercase hex`);
  }
  // Copy out of Buffer's shared pool so the backend owns an exact-length buffer.
  return new Uint8Array(Buffer.from(s, 'hex'));
};

const optionalBigint = (s: unknown, field: string): bigint | undefined => {
  if (s === undefined) return undefined;
  if (typeof s !== 'string' || s.length > MAX_BINDING_DIGITS || !/^\d+$/.test(s)) {
    throw new HttpError(
      400,
      `${field} must be a decimal string of at most ${MAX_BINDING_DIGITS} digits`,
    );
  }
  return BigInt(s);
};

/**
 * A key location is either a bare circuit id or midnight-js's canonical
 * `contract:<address>/<circuit>?vk=<hash>`. Both are reduced to the circuit id, which must be one
 * of the binding's. Anything else (builtins, paths, other contracts' circuits) is refused.
 */
const CANONICAL_LOCATION = /^contract:[0-9a-fA-F]{64}\/([A-Za-z0-9_]+)\?vk=[0-9a-f]{64}$/;
const BARE_LOCATION = /^[A-Za-z0-9_]+$/;

function circuitOf(keyLocation: unknown, circuits: ReadonlySet<string>): string {
  if (typeof keyLocation !== 'string' || keyLocation.length === 0) {
    throw new HttpError(400, 'keyLocation must be a string');
  }
  const circuit = BARE_LOCATION.test(keyLocation)
    ? keyLocation
    : CANONICAL_LOCATION.exec(keyLocation)?.[1];
  if (circuit === undefined || !circuits.has(circuit)) {
    throw new HttpError(403, 'keyLocation is not a circuit of this binding');
  }
  return keyLocation;
}

interface Endpoint {
  readonly limit: number;
  /** What a client sees when the backend fails; `undefined` passes the backend's message through. */
  readonly failure: string | undefined;
  /** Validates the body and returns the work to do, so a bad request never waits in a queue. */
  readonly parse: (body: Record<string, unknown>) => () => Promise<unknown>;
}

export function chainRoute(backend: ChainBackend, options: ChainRouteOptions): Route {
  const { circuits, maxDeploys } = options;
  const log = options.log ?? ((message: string) => console.error(message));
  // One proof or deployment at a time: a P-256 proof needs ~13.5 GiB (Review Focus 5), and a
  // deployment must not overlap one.
  const queue = serial(options.maxQueued ?? DEFAULT_MAX_QUEUED);
  let deploysAccepted = 0;
  const endpoints = new Map<string, Endpoint>([
    [
      '/check',
      {
        limit: PREIMAGE_LIMIT,
        failure: undefined,
        parse: (b) => {
          const preimage = bytes(b.preimage, 'preimage');
          const keyLocation = circuitOf(b.keyLocation, circuits);
          return async () => ({
            result: (await backend.check(preimage, keyLocation)).map((v) =>
              v === undefined ? null : v.toString(),
            ),
          });
        },
      },
    ],
    [
      '/prove',
      {
        limit: PREIMAGE_LIMIT,
        failure: undefined,
        parse: (b) => {
          const preimage = bytes(b.preimage, 'preimage');
          const keyLocation = circuitOf(b.keyLocation, circuits);
          const binding = optionalBigint(b.overwriteBindingInput, 'overwriteBindingInput');
          return async () => ({
            proof: hex(await queue(() => backend.prove(preimage, keyLocation, binding))),
          });
        },
      },
    ],
    [
      '/sponsor/balance',
      {
        limit: TX_LIMIT,
        failure: 'the sponsor could not balance the transaction',
        parse: (b) => {
          const tx = bytes(b.tx, 'tx');
          return async () => ({ tx: hex(await backend.balance(tx)) });
        },
      },
    ],
    [
      '/sponsor/submit',
      {
        limit: TX_LIMIT,
        failure: 'the sponsor could not submit the transaction',
        parse: (b) => {
          const tx = bytes(b.tx, 'tx');
          return async () => ({ txId: await backend.submit(tx) });
        },
      },
    ],
    [
      '/deploy',
      {
        limit: DEPLOY_LIMIT,
        failure: 'the deployment failed',
        parse: (b) => {
          const boot = bytes(b.boot, 'boot');
          const encKey = bytes(b.encKey, 'encKey');
          if (boot.length !== 32 || encKey.length !== 32) {
            throw new HttpError(400, 'boot and encKey must be 32 bytes');
          }
          // The cap counts every accepted request, failures included, so failing deployments
          // cannot be spammed. It is checked here, before the queue, so the refusal is immediate.
          if (deploysAccepted >= maxDeploys) {
            throw new HttpError(429, 'deployment limit reached for this service instance');
          }
          deploysAccepted++;
          return () => queue(() => backend.deploy(boot, encKey));
        },
      },
    ],
  ]);

  return async (req, res, url) => {
    const endpoint = endpoints.get(url.pathname);
    if (!endpoint || req.method !== 'POST') return false;
    const body = await readJson(req, endpoint.limit);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new HttpError(400, 'request body must be a JSON object');
    }
    // A request error (HttpError, here and from readJson) propagates to the server with its own
    // status. The work below can also fail with one (a policy refusal, a full queue), and it is
    // passed through the same way; any other failure is an upstream fault and answers 502.
    const work = endpoint.parse(body as Record<string, unknown>);
    try {
      json(res, 200, await work());
    } catch (e) {
      if (e instanceof HttpError) {
        json(res, e.status, { error: e.message });
      } else {
        const detail = e instanceof Error ? e.message : String(e);
        log(`passport-service: ${url.pathname} failed: ${detail}`);
        json(res, 502, { error: endpoint.failure ?? detail });
      }
    }
    return true;
  };
}
