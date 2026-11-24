import type { FlowOptions } from '@input-output-hk/mn-passport-protocol';
import { startFlow, type Flow } from './flow.js';

/** Keep the JubJub account's per-operation failure checkpoint in one place. */
export function createJubjubRun(fresh: (length: number) => Uint8Array) {
  return async <T>(
    options: FlowOptions,
    body: (flow: Flow) => Promise<T>,
    onProgress?: Parameters<typeof startFlow>[2],
  ): Promise<T> => {
    const flow = startFlow(options, fresh, onProgress);
    try {
      return await body(flow);
    } catch (error) {
      throw flow.fail(error);
    }
  };
}
