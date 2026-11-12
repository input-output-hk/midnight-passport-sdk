---
layout: default
title: Background read and computation tasks
permalink: /background/
---

**Available in RC8; absent from RC7.** `account/background` and `adapter-browser/background`
are optional RC8 exports, absent from published `0.1.0-rc7`. The neutral protocol
works with a host-supplied browser or Node port. It creates no thread, wallet,
credential request, persistent state or transaction retry by importing it. The
[demo worker composition]({{ '/demo-guide/#built-in-wallet-worker' | relative_url }})
is a separate host choice.

## Own a channel and admit method data

`createBackgroundClient(port, options)` returns a `BackgroundClient`; its
`client.request(method, input)` correlates requests and returns `Promise<unknown>`.
Construction can throw synchronously; request failures reject the returned promise.
`serveBackgroundTasks(port, options)` captures an explicit
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

Use this complete `reader.worker.ts` entry. It explicitly starts the server when
the worker module loads and validates again at the receiving boundary:

```ts
import { serveBackgroundTasks } from '@input-output-hk/mn-passport-account/background';
import {
  browserBackgroundPort,
  type BrowserMessageEndpoint,
} from '@input-output-hk/mn-passport-adapter-browser/background';

const endpoint: BrowserMessageEndpoint = {
  postMessage: message => globalThis.postMessage(message),
  addEventListener: (type, listener) => globalThis.addEventListener(type, listener),
  removeEventListener: (type, listener) => globalThis.removeEventListener(type, listener),
};

serveBackgroundTasks(browserBackgroundPort(endpoint, () => globalThis.close()), {
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

Custom teardown callbacks may return promises despite their structural `void` type.
The library observes their rejection without awaiting completion: a stalled cleanup
cannot delay pending-read rejection, and a teardown failure cannot replace the read's
typed outcome. A synchronous `close()` return is not an acknowledgement that an
asynchronous provider shutdown has finished. The browser bridge also observes results
from its injected close action and listener removals; otherwise a rejected promise
can be lost before it reaches the neutral channel. Callback invocation stays at
the original synchronous boundary: a direct bridge close may still throw, while
client/server best-effort teardown retains its existing typed outcome.

The disposer returned by `serveBackgroundTasks` **only unsubscribes and suppresses
later replies**. It does not close its port or stop handlers already running. A
server host must separately close its endpoint or terminate its owned worker when
required. Cancellation of underlying computation is the handler/provider's contract.

Fatal transport failures have a separate cleanup path: synchronous `subscribe`
exceptions are sanitized to `BackgroundError('Unavailable')` and close the owned
endpoint. A server send failure, including an uncloneable native reply, unsubscribes
and closes the channel best effort. Inline failure callbacks and throwing cleanup
cannot strand the owned teardown. The port must surface close/failure to its peer;
custom transports that do not report disconnect may leave that peer waiting until
its timeout. Fatal close does not cancel computation already running in a handler.
Handlers should return cloneable, validated data, and hosts still own orderly endpoint
shutdown after an explicit server stop.

The [async contract tests](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/tests/overnight-async-contracts.test.mjs)
cover startup failure, throwing cleanup and native MessagePort clone/disconnect cases.
These source checks do not turn an RPC timeout into transaction evidence.

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

The [documentation worker regression](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/tests/docs-background-worker.test.mjs)
also executes this exact worker entry in an owned Node worker with browser event
capability shims. It checks startup and valid/invalid requests; it is not an actual
browser-worker or provider qualification.

## Source preview: prove an ACC transaction in a dedicated worker

`adapter-browser/worker-prover` implements the account's transaction-level
`Prover` port. The page supplies an owned dedicated module worker, and the
worker supplies a local Ledger 9 proving provider with verified artifacts.
The page can pass the resulting handle as `prover` to `createBrowserPassport`.

```ts
import { createBrowserWorkerProver } from '@input-output-hk/mn-passport-adapter-browser/worker-prover';

export function openProver() {
  const worker = new Worker(new URL('./prover.worker.ts', import.meta.url), { type: 'module' });
  return createBrowserWorkerProver(worker, { channel: 'example.proving.v1' });
}
```

This example expects `prover.worker.ts` to call `startProver(provider)` below at
module startup, after initializing its local WASM provider. Supply that call in
your worker entry with your own artifact source and WASM packaging.

```ts
import {
  serveBrowserWorkerProver,
  type BrowserWorkerProverOptions,
} from '@input-output-hk/mn-passport-adapter-browser/worker-prover';

export function startProver(provider: BrowserWorkerProverOptions['provider']) {
  return serveBrowserWorkerProver(globalThis, {
    channel: 'example.proving.v1',
    networkId: 'undeployed',
    bindingId: 'acc-s3r1.1',
    circuits: ['append_inbox_with_jubjub'],
    provider,
  });
}
```

The worker announces readiness after installing its request listener. The
client takes one proof at a time, with an 8 MiB transaction limit and a default
ten-minute deadline that includes startup. Cancellation during a proof, a
timeout, or closing the handle terminates the dedicated worker. Create a new
worker and handle for a later attempt. Keep submission and original-intent
recovery in the host's existing flow.

The worker deserializes the transaction, checks its network and exact circuit
set, and admits only proof locations derived from the binding's verifier hashes
and the transaction's calls. The provider must still verify the bytes it loads.
Use `contract.loadArtefact` for the pinned circuit material and independently
pin the Ledger parameters and proving WASM. This profile proves ACC contract
calls without DUST or shielded offers. Transaction construction, credentials,
consent, fees and submission are owned by the host.

For the key service's `/v1/zk/<bindingId>` endpoint, pass
`createBrowserProofArtifacts` from `adapter-browser/worker-proof-artifacts` to
the local engine as its key and parameter callbacks. Configure the manifest
and circuit allowlist from the host's deployment configuration. The host
also supplies each public parameter's URL, byte length and SHA-256. The engine
must treat the cached bytes as read-only. The loader uses the packaged binding
and requires HTTPS or loopback HTTP. It never sends the unproven transaction.

### Assemble a proved ACC call with a DUST fee

The source preview exports `assembleDustFee` from
`adapter-browser/dust-fee-assembly`. Call it in a worker when your host already
has the original proved ACC call and a separate proved DUST fee transaction.
Use the SHA-256 of the original proved bytes from your trusted call pipeline.
Set the network, binding, account and circuit from the reviewed call, and set
the maximum DUST spend and fee expiry from your fee policy.

```ts
import {
  assembleDustFee,
  type DustFeeAssemblyInput,
} from '@input-output-hk/mn-passport-adapter-browser/dust-fee-assembly';

export function finalizeInWorker(approved: DustFeeAssemblyInput): Promise<Uint8Array> {
  return assembleDustFee(approved);
}
```

The helper binds and merges a single ACC call and a single fee intent. It
checks the original bytes, contract and circuit, requires the same network,
and refuses expired intents, asset offers, non-DUST imbalances, rewards and
DUST registrations.
It caps the sum of the DUST spends and requires the fee to expire within the
approved deadline and the original call's expiry. Retain the finalized bytes
before submitting. Binding and merging may produce different bytes when
repeated, so use the retained original for reconciliation. Your host supplies
fee selection, proofs, authorization and submission, and the chain validates
the assembled transaction.
