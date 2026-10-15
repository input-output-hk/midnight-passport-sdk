import type { ServiceConfig } from '../config.ts';
import type { Route } from '../http.ts';
import { serviceConfigRoute } from '@input-output-hk/mn-passport-service';

export { zkRoute, pinnedZkRoute } from '@input-output-hk/mn-passport-service';

export function configRoute(config: ServiceConfig, extra: () => Record<string, unknown>): Route {
  return serviceConfigRoute({ ...config, ...config.publicStack }, extra);
}
