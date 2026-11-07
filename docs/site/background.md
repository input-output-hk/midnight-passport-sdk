---
layout: default
title: Background read and computation tasks
permalink: /background/
---

**Source preview after RC7.** `account/background` and `adapter-browser/background`
are optional source exports, absent from published `0.1.0-rc7`. The neutral protocol
works with a host-supplied browser or Node port. It creates no thread, wallet,
credential request, persistent state or transaction retry by importing it. The
[demo worker composition]({{ '/demo-guide/#built-in-wallet-worker' | relative_url }})
is a separate host choice.

## Own a channel and admit method data

`createBackgroundClient(port, options)` correlates requests and returns
`Promise<unknown>`. `serveBackgroundTasks(port, options)` captures an explicit
allowlist of read/computation handlers. Both require a channel of 1–128 characters
from alphanumerics and `._:-`. Methods start with a letter, then contain alphanumerics,
up to 64 characters. Use a dedicated ordered channel with one client epoch; IDs
increase from one, and the server refuses replayed or out-of-order IDs. Recreating
only the client on an old server can collide with its ID history. A channel string
is routing metadata, not authentication.

Envelopes are strictly validated, but `input` and successful replies are `unknown`.
The protocol has no payload-byte bound or method-specific schema. Bound and validate
input inside each handler and validate replies before UI projection. Native worker
messaging structured-clones data; a custom `BackgroundPort` must define its own copy
boundary. Never use a type assertion to turn an unchecked reply into trusted state.

## Browser example: one owned worker

The page creates and closes its own dedicated module worker. Adjust the worker URL
for your bundler. This example performs one task; a long-lived host may retain the
client and close it when that host scope ends.

```ts
import { createBackgroundClient } from '@input-output-hk/mn-passport-account/background';
import { browserBackgroundPort } from '@input-output-hk/mn-passport-adapter-browser/background';

export async function countAccounts(accounts: readonly string[]): Promise<number> {
  if (accounts.length > 256 || Array.from(accounts).some(value => !/^[0-9a-f]{64}$/.test(value))) {
    throw new Error('Invalid account list');
  }
  const worker = new Worker(new URL('./reader.worker.ts', import.meta.url), { type: 'module' });
  const client = createBackgroundClient(browserBackgroundPort(worker, () => worker.terminate()), {
    channel: 'example.reads.v1',
  });
  try {
    const reply = await client.request('countAccounts', [...accounts]);
    if (typeof reply !== 'number' || !Number.isSafeInteger(reply) || reply < 0 || reply > 256) {
      throw new Error('Invalid worker reply');
    }
    return reply;
  } finally {
    client.close();
  }
}
```

In `reader.worker.ts`, validate again at the receiving boundary:

```ts
import { serveBackgroundTasks } from '@input-output-hk/mn-passport-account/background';
import { browserBackgroundPort } from '@input-output-hk/mn-passport-adapter-browser/background';

declare const self: DedicatedWorkerGlobalScope;

serveBackgroundTasks(browserBackgroundPort(self, () => self.close()), {
  channel: 'example.reads.v1',
  methods: {
    async countAccounts(input: unknown) {
      if (!Array.isArray(input) || input.length > 256 ||
          Array.from(input).some(value => typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))) {
        throw new Error('Invalid account list');
      }
      return input.length;
    },
  },
});
```

This counts public identifiers; it does not verify account existence or ownership.
Keep passkeys and blocking consent in the trusted UI host. If a worker holds secrets,
its host must separately control transfer, lifetime and disposal; RPC adds no custody
or authorization policy.

## Deadlines, failure and teardown

| Setting or outcome | Current contract |
| --- | --- |
| Client `timeoutMs` | Default **120,000 ms**; integer 1–600,000. Per-request waiting budget, not a handler deadline. |
| Client/server `maxPending` | Each defaults to **16**, independently; integer 1–128. |
| `BackgroundError: InvalidMessage` | Invalid settings or request envelope. |
| `Busy` | Client's pending limit reached; nothing was posted. |
| `Rejected` | Server handler failed, method was unknown or server capacity was full. Provider exception details are not returned. |
| `Timeout` | Client stopped waiting; worker work may still be running. Late reply is ignored. |
| `Unavailable` | Transport failed; pending requests reject and the owned client channel closes. |
| `Closed` | Client was explicitly closed; pending and subsequent requests reject. |

There is no per-request cancellation method or `AbortSignal` option. Timeout does
not cancel the handler or close the channel. An explicit read retry is safe only if
the host accepts repeated read/computation work. Never infer mutation failure or
resubmit a transaction from an RPC timeout.

`client.close()` clears timers, unsubscribes, rejects pending work and closes the
owned port, best effort and idempotently. The browser bridge removes its listeners on unsubscribe;
its registration/start failures also close the owned endpoint and report failure. Its
close callback must terminate only the worker/channel the host owns.

The disposer returned by `serveBackgroundTasks` **only unsubscribes and suppresses
later replies**. It does not close its port or stop handlers already running. A
server host must separately close its endpoint or terminate its owned worker when
required. Cancellation of underlying computation is the handler/provider's contract.

Current source has two transport limits awaiting further hardening: a custom port
that throws synchronously from `subscribe` can escape a neutral factory without
owned cleanup; a server reply-post failure unsubscribes without closing the endpoint,
so the client may wait until timeout. The browser bridge handles its own registration
failures, but an arbitrary port must provide equivalent safe startup. Server handlers
must return cloneable results for native messaging. Host teardown must still own
endpoint closure; do not infer immediate disconnect from every provider failure.

## Node and evidence limits

In Node, implement `BackgroundPort` around a `worker_threads` Worker or MessagePort:
`postMessage`, `on/off('message')`, failure events and an owned close action. This
structural port is supported by the neutral package; the browser adapter does not
spawn Node workers or provide a Node-specific factory. Handle transport errors and
close events so pending requests cannot remain stranded. See the tested
[Node port and worker example](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/tests/background.test.mjs).

The same tests cover correlation, limits, timeouts, replay and independent-thread
heartbeat. Browser worker/transport tests establish their exercised synthetic paths,
not real wallet synchronization, native proving or provider acceptance. See
[quality layers]({{ '/quality/' | relative_url }}).
