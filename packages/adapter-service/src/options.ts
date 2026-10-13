import type { FetchLike } from '@input-output-hk/mn-passport-account/ports';

export interface RemoteOptions {
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}
