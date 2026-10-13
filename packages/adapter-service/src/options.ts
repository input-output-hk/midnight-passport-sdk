import type { FetchLike } from '@midnight-ntwrk/mn-passport-account/ports';

export interface RemoteOptions {
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}
