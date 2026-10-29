// Qualification only: terminal reconciliation can return without invoking the poll observer.
import { PassportConnectorError } from '../../packages/account/dist/index.js';
/**
 * @param {ReturnType<typeof import('../../packages/adapter-service/dist/index.js').remoteHostJobPorts>} raw
 * @param {ReturnType<typeof import('../../packages/adapter-service/dist/index.js').remoteHostJobs>} client
 * @param {ReturnType<typeof import('./job-lifecycle-spec.mjs').confirmedReplyLossProbe>} probe
 */
export function observeImageJobReplies(raw, client, probe) {
  return {
    ...raw,
    submitter: {
      /** @param {Parameters<typeof raw.submitter.submit>} args */
      submit: (...args) => {
        probe.track(args[1]?.circuit);
        return raw.submitter.submit(...args);
      },
    },
    outcomes: {
      /** @param {Parameters<typeof raw.outcomes.reconcile>} args */
      async reconcile(...args) {
        const [pins, effect, context] = args;
        const circuit =
          effect.kind === 'call' &&
          effect.input !== null &&
          typeof effect.input === 'object' &&
          'circuit' in effect.input &&
          typeof effect.input.circuit === 'string'
            ? effect.input.circuit
            : undefined;
        probe.track(circuit);
        const answer = await raw.outcomes.reconcile(...args);
        if (effect.kind === 'call' && answer.kind === 'confirmed') {
          const snapshot = await client.get(
            { pins, kind: 'call', requestId: effect.key, intentSha256: effect.digest },
            context?.signal,
          );
          if (snapshot) {
            try {
              probe.observe(snapshot);
            } catch (error) {
              if (!probe.lost) throw error;
              throw new PassportConnectorError(
                'MutationUnsettled',
                'Synthetic owner observation interrupted after original confirmation.',
              );
            }
          }
        }
        return answer;
      },
    },
  };
}
