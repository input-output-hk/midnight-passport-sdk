import { timingSafeEqual } from 'node:crypto';
import { HttpError, json, readJson, type Route } from './http.js';
import type { HostMutationIdentity } from './host-mutations.js';
import {
  HOST_JOB_INPUT_LIMIT,
  type HostJobDescriptor,
  type createHostMutationJobs,
} from './host-jobs.js';

/** Opt-in operator RPC; GET never drives work. Share sponsor admission/queue policy with
 * direct routes. This is not the unauthenticated legacy /v1/jobs callback protocol. */
export function hostJobRoute(options: {
  jobs: ReturnType<typeof createHostMutationJobs>;
  token: Uint8Array;
  pins: Pick<HostMutationIdentity['pins'], 'networkId' | 'bindingId' | 'manifestSha256'>;
}): Route {
  if (options.token.length !== 32) throw new Error('Host job token must be 32 bytes.');
  const expected = Buffer.from(`Bearer ${Buffer.from(options.token).toString('hex')}`);
  const pins = { ...options.pins };
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/v1/host-jobs/')) return false;
    const supplied = Buffer.from(
      typeof req.headers.authorization === 'string' ? req.headers.authorization : '',
    );
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      throw new HttpError(401, 'host job authentication required');
    if (req.method === 'GET' && /^\/v1\/host-jobs\/[0-9a-f]{32}$/.test(url.pathname)) {
      if (
        [...url.searchParams.keys()].some((k) => k !== 'after') ||
        url.searchParams.getAll('after').length > 1
      )
        throw new HttpError(400, 'invalid host job cursor');
      const job = await options.jobs.get(
        url.pathname.split('/').at(-1)!,
        url.searchParams.get('after') ?? undefined,
      );
      if (!job) throw new HttpError(404, 'host job not found');
      json(res, 200, job);
      return true;
    }
    const action = url.pathname.slice('/v1/host-jobs/'.length);
    if (req.method !== 'POST' || !['accept', 'start', 'reconcile'].includes(action))
      throw new HttpError(404, 'unknown host job operation');
    if (url.search) throw new HttpError(400, 'unexpected host job query');
    const body = await readJson(req, action === 'accept' ? HOST_JOB_INPUT_LIMIT + 4096 : 256);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new HttpError(400, 'invalid host job request');
    if (action === 'accept') {
      const d = body as HostJobDescriptor,
        p = d.identity?.pins;
      if (
        !p ||
        p.networkId !== pins.networkId ||
        p.bindingId !== pins.bindingId ||
        p.manifestSha256 !== pins.manifestSha256
      )
        throw new HttpError(409, 'host job service pins differ');
      json(res, 202, await options.jobs.accept(d));
    } else {
      const b = body as Record<string, unknown>;
      if (Object.keys(b).length !== 1 || typeof b.jobId !== 'string')
        throw new HttpError(400, 'invalid host job request');
      json(res, 202, await options.jobs[action === 'start' ? 'start' : 'reconcile'](b.jobId));
    }
    return true;
  };
}
