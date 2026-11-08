import type { IsolationProfile } from './native-isolation-profile.mjs';

export type WorkerKind = 'live' | 'wallet-transfer' | 'wallet-reconnect';
export interface WorkerAdmission {
  kind: WorkerKind;
  root: string | undefined;
  arm: string | undefined;
  mode?: string | undefined;
  operation?: string | undefined;
  fault?: string | undefined;
  env?: NodeJS.ProcessEnv;
}

/** Read-only admission; undefined means every isolation marker was absent. */
export function nativeIsolationWorker(request: WorkerAdmission): IsolationProfile | undefined;
