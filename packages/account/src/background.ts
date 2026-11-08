import { z } from 'zod';
import type { BackgroundClient, BackgroundPort } from './ports/background.js';
export type { BackgroundClient, BackgroundPort } from './ports/background.js';

const requestSchema = z.strictObject({
  protocol: z.literal('passport-background-v1'),
  channel: z.string().min(1).max(128),
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  method: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  input: z.unknown(),
});
const replySchema = z.strictObject({
  protocol: z.literal('passport-background-v1'),
  channel: z.string().min(1).max(128),
  id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  ok: z.boolean(),
  value: z.unknown().optional(),
});
export class BackgroundError extends Error {
  constructor(
    readonly code: 'Closed' | 'Unavailable' | 'Timeout' | 'Busy' | 'InvalidMessage' | 'Rejected',
  ) {
    super(`Background task: ${code}.`);
    this.name = 'BackgroundError';
  }
}
// These timer capabilities exist on both web and Node; no ambient DOM/Node dependency.
const timers = globalThis as unknown as {
  setTimeout(work: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};
function settings(channel: string, maximum: number) {
  if (
    !/^[a-zA-Z0-9._:-]{1,128}$/.test(channel) ||
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > 128
  )
    throw new BackgroundError('InvalidMessage');
}

/**
 * Bounded, correlated read/computation RPC. No credentials, persistence, signing-route
 * selection or transaction retry. Hosts validate method-specific results before projection.
 */
export function createBackgroundClient(
  port: BackgroundPort,
  options: {
    channel: string;
    timeoutMs?: number;
    maxPending?: number;
  },
): BackgroundClient {
  const { channel, timeoutMs = 120_000, maxPending = 16 } = options;
  settings(channel, maxPending);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000)
    throw new BackgroundError('InvalidMessage');
  let closed = false;
  let nextId = 0;
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: BackgroundError): void; timer: unknown }
  >();
  let unsubscribe = () => {};
  const close = (code: 'Closed' | 'Unavailable') => {
    if (closed) return;
    closed = true;
    try {
      unsubscribe();
    } catch {
      /* Teardown must not strand pending reads. */
    }
    for (const request of pending.values()) {
      timers.clearTimeout(request.timer);
      request.reject(new BackgroundError(code));
    }
    pending.clear();
    try {
      port.close();
    } catch {
      /* The channel is already unusable. */
    }
  };
  try {
    unsubscribe = port.subscribe(
      (message) => {
        const parsed = replySchema.safeParse(message);
        if (!parsed.success || parsed.data.channel !== channel) return;
        const reply = parsed.data;
        const request = pending.get(reply.id);
        if (!request) return; // late, duplicate or from an earlier client epoch
        pending.delete(reply.id);
        timers.clearTimeout(request.timer);
        if (reply.ok) request.resolve(reply.value);
        else request.reject(new BackgroundError('Rejected'));
      },
      () => close('Unavailable'),
    );
  } catch {
    close('Unavailable');
    throw new BackgroundError('Unavailable');
  }
  if (closed) {
    try {
      unsubscribe();
    } catch {
      /* Already closed. */
    }
  }
  return {
    request(method, input) {
      if (closed) return Promise.reject(new BackgroundError('Closed'));
      if (pending.size >= maxPending) return Promise.reject(new BackgroundError('Busy'));
      const id = ++nextId;
      const parsed = requestSchema.safeParse({
        protocol: 'passport-background-v1',
        channel,
        id,
        method,
        input,
      });
      if (!parsed.success) return Promise.reject(new BackgroundError('InvalidMessage'));
      return new Promise((resolve, reject) => {
        const timer = timers.setTimeout(() => {
          pending.delete(id);
          reject(new BackgroundError('Timeout'));
        }, timeoutMs);
        pending.set(id, { resolve, reject, timer });
        try {
          port.post(parsed.data);
        } catch {
          close('Unavailable');
        }
      });
    },
    close: () => close('Closed'),
  };
}

/** Bind explicit read/computation methods inside an owned worker, never a dynamic object proxy. */
export function serveBackgroundTasks(
  port: BackgroundPort,
  options: {
    channel: string;
    methods: Readonly<Record<string, (input: unknown) => Promise<unknown>>>;
    maxPending?: number;
  },
): () => void {
  const { channel, maxPending = 16 } = options;
  settings(channel, maxPending);
  const methods = new Map(Object.entries(options.methods));
  let closed = false;
  let active = 0;
  let lastId = 0;
  const reply = (id: number, ok: boolean, value?: unknown) => {
    if (closed) return;
    try {
      port.post({ protocol: 'passport-background-v1', channel, id, ok, ...(ok && { value }) });
    } catch {
      fail();
    }
  };
  let unsubscribe = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      unsubscribe();
    } catch {
      /* Teardown must not strand pending reads. */
    }
  };
  const fail = () => {
    if (closed) return;
    close();
    try {
      port.close();
    } catch {
      /* A fatal transport failure cannot expose provider teardown details. */
    }
  };
  try {
    unsubscribe = port.subscribe((message) => {
      const parsed = requestSchema.safeParse(message);
      if (!parsed.success || parsed.data.channel !== channel || closed) return;
      const request = parsed.data;
      // A dedicated MessagePort preserves send order. Do not execute replayed requests twice.
      if (request.id <= lastId) return;
      lastId = request.id;
      const method = methods.get(request.method);
      if (!method || active >= maxPending) {
        reply(request.id, false);
        return;
      }
      active++;
      void Promise.resolve()
        .then(() => method(request.input))
        .then(
          (value) => reply(request.id, true, value),
          () => reply(request.id, false), // No secret-bearing exception crosses the boundary.
        )
        .finally(() => {
          active--;
        });
    }, fail);
  } catch {
    fail();
    throw new BackgroundError('Unavailable');
  }
  if (closed) {
    try {
      unsubscribe();
    } catch {
      /* Already closed. */
    }
  }
  return close;
}
