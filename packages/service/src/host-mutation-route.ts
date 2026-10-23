import { timingSafeEqual } from 'node:crypto';
import { HttpError, json, readJson, type Route } from './http.js';
import { serial } from './queue.js';
import {
  hostHash,
  validateHostIdentity,
  type HostMutationIdentity,
  type HostJson,
  createHostMutationExecutor,
} from './host-mutations.js';

/** Dedicated opt-in authenticated RPC. Never expose protected inputs, plans or transaction bytes.
 * Each reconcile POST explicitly continues the SAME already approved operation. It cannot
 * replace a pending byte sequence or restart a missing constructor plan.
 */
export function hostMutationRoute(options: {
  executor: ReturnType<typeof createHostMutationExecutor>;
  pins: Pick<HostMutationIdentity['pins'], 'networkId' | 'bindingId' | 'manifestSha256'>;
  token: Uint8Array;
  runExclusive?: ReturnType<typeof serial>;
  acceptDeployment?: () => void;
}): Route {
  if (options.token.length !== 32) throw new Error('Host mutation token must be 32 bytes.');
  const token = Buffer.from(options.token).toString('hex'),
    exclusive = options.runExclusive ?? serial(8);
  return async (req, res, url) => {
    if (!url.pathname.startsWith('/v1/mutations/')) return false;
    const supplied = req.headers.authorization;
    const expected = Buffer.from(`Bearer ${token}`),
      actual = Buffer.from(typeof supplied === 'string' ? supplied : '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new HttpError(401, 'host mutation authentication required');
    if (
      req.method !== 'POST' ||
      !['execute', 'reconcile', 'status'].includes(url.pathname.slice('/v1/mutations/'.length))
    )
      throw new HttpError(404, 'unknown host mutation operation');
    const value = (await readJson(req, 8 * 1024 * 1024)) as {
      identity?: HostMutationIdentity;
      input?: HostJson;
    };
    try {
      if (!value || typeof value !== 'object' || Array.isArray(value) || !value.identity)
        throw new Error('invalid request');
      const identity = value.identity;
      validateHostIdentity(identity);
      const { networkId, bindingId, manifestSha256 } = identity.pins;
      if (
        hostHash({ networkId, bindingId, manifestSha256 }) !==
        hostHash({
          networkId: options.pins.networkId,
          bindingId: options.pins.bindingId,
          manifestSha256: options.pins.manifestSha256,
        })
      )
        throw new Error('wrong service pins');
      const controller = new AbortController();
      if (res.destroyed || req.aborted) controller.abort();
      res.once('close', () => {
        if (!res.writableEnded) controller.abort();
      });
      const result = await exclusive(async () => {
        if (url.pathname.endsWith('/status')) return options.executor.outcome(identity);
        if (url.pathname.endsWith('/reconcile'))
          return options.executor.resume(identity, { signal: controller.signal });
        if (value.input === undefined) throw new Error('missing protected input');
        if (identity.kind === 'deploy' && !(await options.executor.inspect(identity)))
          options.acceptDeployment?.();
        return options.executor.execute(identity, value.input, { signal: controller.signal });
      });
      json(res, 200, result);
    } catch {
      throw new HttpError(
        409,
        'host mutation unsettled; reuse the original request ID and reconcile',
      );
    }
    return true;
  };
}
