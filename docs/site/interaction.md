---
layout: default
title: Reusable interaction models
permalink: /interaction/
---

**Available in RC8; absent from RC7.** This API is not in the published RC7 packages. It adds
no package, React dependency or browser requirement. Import the optional
`@input-output-hk/mn-passport-account/interaction` subpath. The source compiles
with only the ES2022 library; it does not load account cryptography.

## Purpose

Use public observations of an account operation to feed host-owned
`OperationStatus`, `Journey` and `ActivityPanel` controls. The SDK supplies stable,
immutable data and progress arithmetic. The host supplies layout, theme, text,
operation IDs, redaction, timing and permission facts. Rendering or subscribing
never creates a passkey, derives a key, connects a wallet or submits a transaction.

These are presentation models. They do not replace the account API, durable
intent journal, chain reconciliation, consent, transaction guard or key session.
An optional wallet connection is not proof of ACC ownership or viewing/spending
permission. Disposing a model does not revoke a grant or undo a submission.

## Project an operation

```ts
import {
  createActivityStore,
  createOperationStatus,
} from '@input-output-hk/mn-passport-account/interaction';

const activity = createActivityStore({
  journey: [
    { id: 'account', title: 'Open Passport account', phase: 'done' },
    { id: 'wallet', title: 'Connect Midnight wallet', phase: 'optional' },
  ],
});

// Host observation, already redacted. Keep original IDs from the account/service.
const operation = createOperationStatus({
  id: 'host-operation-1',
  title: 'Create account',
  phase: 'running',
  startedAt: 1000,
  references: { flowId: 'original-flow-id', requestId: 'original-request-id' },
  stages: [
    { id: 'passkey', title: 'Prepare passkey', phase: 'succeeded', startedAt: 1000, endedAt: 2000 },
    { id: 'deploy', title: 'Deploy account', phase: 'running', startedAt: 2000, estimateMs: 180000 },
    { id: 'activate', title: 'Activate device', phase: 'pending' },
  ],
}, 92000); // explicit host clock, in the same time domain as startedAt

const previous = activity.getSnapshot();
activity.replace({ operation, journey: previous.journey }, previous.revision);

const detach = activity.subscribe(() => {
  // Render text safely. No credential, wallet or transaction call here.
  console.log(activity.getSnapshot().operation?.phase);
});
detach(); // detach this renderer; the operation remains intact
```

`createOperationStatus` copies only documented public fields, freezes the result
and rejects malformed times, phases and duplicate stage IDs. Use Unix epoch or a
monotonic time domain consistently. Backwards clock movement clamps elapsed/fill
to zero. Terminal success, failure and cancellation require an attempt end time;
an unknown outcome may remain open while the host reconciles it.

### State and progress

| Model | States | Meaning |
| --- | --- | --- |
| Operation | `running`, `succeeded`, `failed`, `cancelled`, `unknown` | Supplied by the host, never inferred from elapsed time. `endedAt` ends the host attempt, not necessarily its on-chain effect. |
| Stage | `pending`, `running`, `succeeded`, `failed`, `unknown`, `skipped` | Successful/failed observations stay distinct; future stages are never filled automatically. |
| Journey | `pending`, `current`, `done`, `optional`, `blocked` | Host-owned guidance; optional wallet setup must remain optional. |

Stages with duration estimates receive `weight = max(1, estimateMs / 20000)`.
While running, `fillPercent` stops at **97**, including after the estimate expires.
An unestimated running stage or unknown outcome has **no numeric fill**; render
it as indeterminate. A failed stage may have fill 100 but is still explicitly
`failed`; do not style it as successful. A skipped stage has fill zero.
The model intentionally supplies no aggregate “confirmation percentage”.

## Stable subscriptions and stale results

`getSnapshot()` returns the same object until an accepted `replace`.
Subscriptions have separate cleanup ownership, including identical callbacks.
Subscribe/unsubscribe/dispose never starts or replays an action. These properties
support an external-store adapter in a framework without placing that framework
in the SDK. The optional React example and actual UI controls are tracked in
[#292](https://github.com/input-output-hk/midnight-passport-sdk/issues/292) and
[#290](https://github.com/input-output-hk/midnight-passport-sdk/issues/290).

Before an asynchronous presentation read, capture `getSnapshot().revision`.
`replace(next, capturedRevision)` returns false if another update won. Build a
new observation from current facts instead of retrying a stale snapshot with
a freshly read revision. The comparison is in-memory presentation ordering,
not cross-tab locking, finality, persistent recovery or a transaction guard.

An invalid replacement throws without changing the snapshot. An accepted
replacement notifies every still-subscribed host. If a renderer throws, the
other hosts are still notified and `replace` throws `AggregateError` **after**
committing the presentation snapshot. Do not retry an account operation in
response to a rendering exception. `dispose()` is idempotent, clears listeners,
refuses later replacements and preserves the last snapshot and its IDs.

## Audit and consent boundaries

The operation `id` locates a host-owned Audit entry. Optional `references` preserve
the original `flowId`, `intentId`, `requestId` and `transactionId`. They are public
identifiers, not retry commands or a sanitized request/response body. Never put
seeds, PRF output, keys, bearer tokens or witnesses into titles or identifiers.
Unknown extensions are discarded; allowed strings are not a secret detector.

Keep full redacted exchanges in Audit and link there from the operation summary.
Every actual credential request and retry still needs the separate blocking
[passkey review]({{ '/consent/' | relative_url }}). Activity collapse, mobile sheet
dismissal, effect cleanup and navigation are presentation actions only.

## Current evidence and scope

The source tests exercise estimates, clock skew, unknown references, interrupted
attempts, public-field copies, frozen snapshots, stale async writes, two host
subscriptions, cleanup/remount and renderer failure. The current browser demo
uses this arithmetic through its own flow/copy adapter. This alone does not
qualify a redesigned shell, React renderer, React Native, real provider, native
proof, released artifact or full Lace integration.

That demo adapter retains raw client/service event timestamps in Audit but clamps
inverted intervals for presentation. Independent clocks must not make a progress
listener throw and interrupt polling after a deployment has been submitted.
Raw mixed-clock intervals are not reliable duration measurements; compare a
service event's own duration or use a single host observation clock for estimates.

The [UX milestone](https://github.com/input-output-hk/midnight-passport-sdk/milestone/3)
tracks delivery. `lace-sdk` integration is outside it; the separate Lace Wallet
connection must be capability- and network-checked before any claim of support.

The local [demo workspace and DOM controls]({{ "/demo-ui/" | relative_url }}) now
compose these snapshots. Their browser evidence is separate from the pure model
tests; optional React and Lace Wallet adapters remain tracked work.
