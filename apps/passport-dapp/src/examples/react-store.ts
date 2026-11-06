// Optional React wiring only: no DOM, account command, timer or controller construction.
import { useSyncExternalStore } from 'react';
import type { ActivityStore } from '@input-output-hk/mn-passport-account/interaction';

export type ActivityReader = Pick<ActivityStore, 'subscribe' | 'getSnapshot'>;

/** Browser hook. An SSR host must supply a matching server snapshot separately. */
export const usePassportActivity = (store: ActivityReader) =>
  useSyncExternalStore(store.subscribe, store.getSnapshot);
