// App-owned projection of actual public observations, independent of DOM and renderers.
import type {
  ActivityObservation,
  OperationReferences,
} from '@input-output-hk/mn-passport-account/interaction';
import type { EventLog } from './event-log.js';
import { operationStatus } from './progress.js';

export function demoActivityObservation(
  log: EventLog,
  now: number,
  facts: {
    readonly accountOpen: boolean;
    readonly walletConnected: boolean;
  },
): ActivityObservation {
  const run = log.last;
  const trace = run ? log.traceOf(run) : [];
  // Only a controller begin transition belonging to this action can establish its session
  // intent. Timer/imported blocked states must not lend an unrelated intent to a public read.
  const beginPhase =
    run?.action === 'startSession'
      ? 'authorizing'
      : run?.action === 'withdraw'
        ? 'spending'
        : run?.action === 'revokeSession'
          ? 'revoking'
          : undefined;
  const sessionIntent =
    beginPhase === undefined
      ? undefined
      : trace.find(
          (entry) =>
            entry.kind === 'session.state' &&
            entry.details.phase === beginPhase &&
            typeof entry.details.intentId === 'string',
        )?.details.intentId;
  const ownTrace = trace.filter(
    (entry) =>
      entry.kind !== 'session.state' ||
      (sessionIntent !== undefined && entry.details.intentId === sessionIntent),
  );
  const references: { -readonly [K in keyof OperationReferences]: OperationReferences[K] } = {};
  const collect = (data: Record<string, unknown>) => {
    for (const [source, target] of [
      ['flowId', 'flowId'],
      ['intentId', 'intentId'],
      ['requestId', 'requestId'],
      ['txId', 'transactionId'],
      ['txHash', 'transactionId'],
    ] as const) {
      const value = data[source];
      if (typeof value === 'string' && value.length > 0 && value.length <= 1024)
        references[target] = value;
    }
    for (const key of ['body', 'result']) {
      const nested = data[key];
      if (typeof nested === 'object' && nested !== null && !Array.isArray(nested))
        collect(nested as Record<string, unknown>);
    }
  };
  for (const entry of ownTrace) collect(entry.details);
  const declined =
    run &&
    run.state !== 'running' &&
    (run.error?.code === 'UserCancelled' ||
      ownTrace.some((entry) => entry.kind === 'action.declined' || /cancelled$/i.test(entry.kind)));
  const lastSessionState = [...ownTrace].reverse().find((entry) => entry.kind === 'session.state');
  const uncertain =
    run?.error &&
    (lastSessionState?.details.phase === 'blocked' ||
      /unknown|pending|FundingRejected|reconcile|SessionBlocked/i.test(run.error.code));
  const phase = uncertain
    ? ('unknown' as const)
    : declined
      ? ('cancelled' as const)
      : run?.state === 'done'
        ? ('succeeded' as const)
        : run?.state;
  const operation =
    run && phase
      ? operationStatus(run, log.stagesOf(run), now, {
          id: `operation-${log.runs.length}`,
          phase,
          references,
        })
      : undefined;
  return {
    ...(operation && { operation }),
    journey: [
      {
        id: 'account',
        title: 'Create or open Passport account',
        phase: facts.accountOpen ? 'done' : 'current',
      },
      { id: 'access', title: 'Review security and access in Settings', phase: 'optional' },
      {
        id: 'wallet',
        title: 'Connect a separate Midnight wallet',
        phase: facts.walletConnected ? 'done' : 'optional',
      },
    ],
  };
}
