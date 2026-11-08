/** Structural bridge implemented by a Web Worker or a Node worker_threads MessagePort. */
export interface BackgroundPort {
  post(message: unknown): void;
  /** Failure means this transport is unusable; do not expose provider exception details. */
  subscribe(receive: (message: unknown) => void, fail: () => void): () => void;
  /** The caller owns this channel/worker. Never close an unrelated shared worker. */
  close(): void;
}
export interface BackgroundClient {
  /** Read/computation requests only. Timeout is not a transaction outcome. */
  request(method: string, input: unknown): Promise<unknown>;
  close(): void;
}
