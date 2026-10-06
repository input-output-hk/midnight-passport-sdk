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

const hex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

const bytes = (s: unknown, field: string): Uint8Array => {
  if (typeof s !== 'string' || s.length === 0 || !/^([0-9a-f]{2})+$/.test(s)) {
    throw new HttpError(400, `${field} must be non-empty lowercase hex`);
  }
  // Copy out of Buffer's shared pool so the backend owns an exact-length buffer.
  return new Uint8Array(Buffer.from(s, 'hex'));
};

const text = (s: unknown, field: string): string => {
  if (typeof s !== 'string' || s.length === 0)
    throw new HttpError(400, `${field} must be a string`);
  return s;
};

const optionalBigint = (s: unknown, field: string): bigint | undefined => {
  if (s === undefined) return undefined;
  if (typeof s !== 'string' || !/^\d+$/.test(s)) {
    throw new HttpError(400, `${field} must be a decimal string`);
  }
  return BigInt(s);
};

interface Endpoint {
  readonly limit: number;
  /** Validates the body and returns the work to do, so a bad request never waits in a queue. */
  readonly parse: (body: Record<string, unknown>) => () => Promise<unknown>;
}

export function chainRoute(backend: ChainBackend): Route {
  // One proof at a time: a P-256 proof needs ~13.5 GiB (Review Focus 5).
  const queue = serial();
  const endpoints = new Map<string, Endpoint>([
    [
      '/check',
      {
        limit: PREIMAGE_LIMIT,
        parse: (b) => {
          const preimage = bytes(b.preimage, 'preimage');
          const keyLocation = text(b.keyLocation, 'keyLocation');
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
        parse: (b) => {
          const preimage = bytes(b.preimage, 'preimage');
          const keyLocation = text(b.keyLocation, 'keyLocation');
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
        parse: (b) => {
          const boot = bytes(b.boot, 'boot');
          const encKey = bytes(b.encKey, 'encKey');
          if (boot.length !== 32 || encKey.length !== 32) {
            throw new HttpError(400, 'boot and encKey must be 32 bytes');
          }
          return () => backend.deploy(boot, encKey);
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
    // Request errors (HttpError, here and from readJson) propagate to the server with their own
    // status; anything the backend throws is an upstream failure and answers 502.
    const work = endpoint.parse(body as Record<string, unknown>);
    try {
      json(res, 200, await work());
    } catch (e) {
      json(res, 502, { error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  };
}
