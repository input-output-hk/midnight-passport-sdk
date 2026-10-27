import type { Server } from 'node:http';
import type { serial } from '@input-output-hk/mn-passport-service';
import type { ConfiguredHostMutations } from './host-config.ts';

/** Idempotent drain for the configured process, never deletion or rollback. A caller may
 * impose a deadline, but cannot treat that deadline as proof of no broadcast. */
export function serviceShutdown(
  server: Server,
  host?: ConfiguredHostMutations,
  runExclusive?: ReturnType<typeof serial>,
) {
  let stopping: Promise<void> | undefined;
  return () =>
    (stopping ??= (async () => {
      host?.stopAdmission();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections();
      });
      await host?.close();
      // Legacy callback jobs also enqueue on this wallet queue before their HTTP ack.
      if (runExclusive?.drain) await runExclusive.drain();
      else await runExclusive?.(async () => {});
    })());
}

/** Signal handler factory: idempotent even across SIGINT/SIGTERM. Forced exit is a failed
 * drain with unknown finality, not a cancellation receipt. The main process owns signals. */
export function shutdownHandler(
  stop: () => Promise<void>,
  options: {
    readonly deadlineMs?: number;
    readonly exit?: (code: number) => void;
    readonly log?: (message: string) => void;
  } = {},
) {
  const deadlineMs = options.deadlineMs ?? 30000,
    exit = options.exit ?? ((code: number) => process.exit(code)),
    log = options.log ?? ((message: string) => console.error(message));
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 2147483647)
    throw new Error('Invalid shutdown deadline.');
  let stopping = false,
    exited = false;
  const finish = (code: number) => {
    if (!exited) {
      exited = true;
      exit(code);
    }
  };
  return () => {
    if (stopping) return;
    stopping = true;
    log('passport-service: draining accepted host work; retain original IDs and journals');
    const deadline = setTimeout(() => {
      log(
        'passport-service: drain deadline reached; outcome may be unknown; retain journals and reconcile',
      );
      finish(1);
    }, deadlineMs);
    void Promise.resolve()
      .then(stop)
      .then(
        () => {
          clearTimeout(deadline);
          finish(0);
        },
        () => {
          clearTimeout(deadline);
          log('passport-service: drain failed; retain original IDs and journals');
          finish(1);
        },
      );
  };
}
