---
layout: default
title: Durable host mutation jobs
permalink: /service-jobs/
---

**Unreleased source work for #233.** This opt-in Node API is local milestone work.
Published RC5, the default demo and the legacy `/v1/jobs` protocol are unchanged.
No new native proof, browser-provider or full Lace qualification is claimed.

## Problem and supported scope

A proof/deployment HTTP request can outlive a proxy connection or a service process.
`createMemoryJobStore.start(work)` retains a JavaScript closure in one process;
serialising that closure cannot reconstruct its authority, generated outputs or
transaction history after a restart.

`createHostMutationJobs` instead accepts a versioned descriptor for one existing
host call or deployment effect. Its identity carries the original owner mutation
request ID, intent digest, network, binding, manifest and authoriser scheme. The
protected input is the original built transaction or complete deployment request.
The existing [host mutation journal]({{ '/host-durability/' | relative_url }}) owns
constructor output, prepared bytes, dispatch fences and finality milestones.
The job journal adds durable acceptance and bounded public status around it.

A larger create/device/rotation operation still needs its
[owner coordinator]({{ '/durability/' | relative_url }}). A host job tracks one of
that coordinator's effects. It does not add owner authority or retry a key ceremony.

## Lifecycle and restart contract

| Current state | Explicit start | Explicit reconcile | GET status |
| --- | --- | --- | --- |
| `queued` | One CAS winner persists `running`, then schedules original execution | Leaves it queued | Reads only |
| `running` | Returns the same ID; never executes again | Looks for the original host record and resumes it if present | Reads only |
| `unknown` | Returns the same ID; never executes again | Same original host record and approval only | Reads only |
| `done` | Returns the same ID without effects | Returns the same ID without effects | Returns confirmed public outcome until expiry |
| `expired` public view | Retains the completed identity; no execution | No execution | Hides the old result; retains its cursor and milestones |

Acceptance is acknowledged only after the immutable descriptor is persisted.
Starting claims the job before calling the executor. There is no automatic restart
scanner or callback replay. After a lost start acknowledgement, the record may be
`running` even if the host call never began. That uncertainty is deliberate.

An absent host record cannot fence a late original request. Reconciliation leaves
that job `unknown`; it never calls `execute` to replace it. A late original worker
can still finish its one authorised call. Its stale job update cannot overwrite a
newer observation; explicit reconciliation can subsequently collect its receipt.
Unknown finality and unchanged milestones add no repeated job revisions or events.

A generic driver, queue or storage exception is not a terminal no-send receipt.
It leaves an unknown or retained running record. The public error is the fixed
`MutationUnsettled` message, without backend diagnostics. This slice has no
terminal `failed` state for uncertain host submissions. The old memory callback
jobs retain their separate `failed` state and process-local semantics.

Confirmed outcomes must match the original digest and a committed complete host
record. Reconciliation also pins the SHA-256 of the original protected input through
`resume(identity, { expectedInputSha256 })`. An existing host record with the same
identity but different input cannot confirm this job or trigger another send.
Reconciliation refuses observed milestone regression. Rollback/deletion
of both journals still requires an external trusted revision anchor; this local
store does not claim to detect it.

## Node composition

The service package exports `createHostMutationJobs`, `createMemoryHostJobStore`,
`encryptedHostJobStore`, `hostJobRoute` and their TypeScript types. The encrypted
adapter uses immutable revision files and atomic CAS on a private local POSIX
filesystem. Use separate host-job and host-mutation journal directories and keys.
Keep the job key separate from the sponsor seed and RPC token.

```ts
import {
  createHostMutationJobs,
  encryptedHostJobStore,
  hostJobRoute,
  type HostJobExecutor,
  type HostJobOptions,
  type serial,
} from '@input-output-hk/mn-passport-service';

export function hostJobs(
  executor: HostJobExecutor,
  pins: HostJobOptions['pins'],
  directory: string,
  jobKey: Uint8Array,
  rpcToken: Uint8Array,
  walletQueue: ReturnType<typeof serial>,
) {
  const store = encryptedHostJobStore(directory, jobKey, { maxJobs: 128 });
  const jobs = createHostMutationJobs(store, executor, {
    pins,
    eventLimit: 32,
    completedTtlMs: 600_000,
    maxActive: 8,
    runExclusive: walletQueue,
  });
  return {
    jobs,
    route: hostJobRoute({ jobs, pins, token: rpcToken }),
    async stop() {
      jobs.stopAdmission();
      await jobs.drain();
      store.close();
    },
  };
}
```

Supply the existing pinned executor over its retained encrypted host journal.
Share the **same wallet queue** with direct mutation and legacy routes in the
process, and enforce the host's fee, deployment and ingress policies. The job
capacity limit is not a fee budget or a distributed sponsor-wallet lock. Multiple
processes still need an appropriate wallet topology. This API is not enabled by
the reference application; an operator must explicitly compose it.

Stop HTTP admission before closing the stores. `stopAdmission()` refuses new job
work; `drain()` also waits for start claims still awaiting their CAS acknowledgement.
It does not cancel an accepted operation or undo a broadcast. Retain the same
journals, keys, pins and original IDs on restart.

## Authenticated HTTP contract

All routes under `/v1/host-jobs/` require the dedicated 32-byte token as
`Authorization: Bearer <64 lowercase hex characters>`. This is an operator RPC;
do not embed the token in a public page. Service pins are checked before work,
including when reopening a stored job under a new service configuration.

| Request | Body | Response |
| --- | --- | --- |
| `POST /v1/host-jobs/accept` | `{version: 1, identity, input}` | `202 {jobId}` after persisted acceptance; does not start work |
| `POST /v1/host-jobs/start` | `{jobId}` | `202 {jobId}` after single-start claim/admission, without waiting for proof/finality |
| `POST /v1/host-jobs/reconcile` | `{jobId}` | `202 {jobId}` for explicit same-intent continuation; no new execute |
| `GET /v1/host-jobs/{jobId}?after={cursor}` | None | `200` public snapshot and retained event delta |

A `202` is not finality. Poll the same ID for the result. If the acceptance response
is lost, resubmit the **same descriptor** to recover its deterministic job ID.
A changed identity digest or input under that request ID is a conflict. A lost
start/reconcile response or disconnected caller does not cancel the durable work;
poll or explicitly reconcile the original job. No new owner request or proof is
automatically constructed from an unknown result.

The call input requires `address`, `circuit` and lowercase hex `tx`. The deployment
input requires `boot`, `encKey`, `retireAuthority` and explicit `firstArm`.
Extra descriptor/input fields are refused. Circuit availability, signature,
frontier, TTL, verifier roster and exact-value checks remain the executor's job.

Status includes `state`, public `milestones`, bounded `events`, `cursor` and
`firstCursor`. A done result includes only its checked public host outcome.
It never includes the descriptor, transaction bytes, constructor plan, key or
arbitrary error/progress payload. Initial snapshots return the retained tail;
`firstCursor` describes its lower boundary. A supplied stale cursor returns 410;
malformed or future cursors return 400. GET never drives ledger work.

## Bounds and retention

| Bound | Default / maximum | Behaviour |
| --- | --- | --- |
| Unique stored identities | 128 / 4096 | Shared durable admission index; full store refuses with 503 |
| Canonical protected input | 4 MiB | Refused before acceptance; existing direct transport has its own limits |
| Retained events per job | 32 / 256 | Ring with monotonic cursor; no silent delta gap |
| Active/scheduled work | 8 / 128 per coordinator | Saturated start leaves its job queued; no distributed wallet lock |
| Completed-result visibility | 10 minutes / 10 years | `expired` view hides result; identity and capacity remain reserved |

The event/TTL policy is stored with each job and survives configuration changes.
Terminal IDs and uncertain IDs are never evicted or made reusable. A capacity
reservation can survive a lost acceptance write; retry the original descriptor.
Increase capacity through operator policy without deleting history. Immutable
revision files retain previous protected values, so result expiry does **not**
erase private data or reclaim disk. There is no automatic compaction/key migration.
Plan disk headroom, protect backups and retain the job key for recovery.

The memory adapter enforces the same in-process state rules but loses them on
restart. Do not describe it as durable. The legacy `JobStore.start(callback)` is
not a drop-in durable adapter contract; existing `/v1/prove-tx`, `/v1/deploy` and
`remoteV1*` clients keep their original separate protocol.

## Qualification boundary

The source tests use fake chain drivers and real Node HTTP/files/processes. They
exercise encrypted reopen, process kill before host registration and after fake
broadcast, competing claims, lost acknowledgements, missing/late host work,
corruption/wrong keys, cursor/retention bounds and backpressure. They do not establish
native proof/image behaviour, real providers, complete #233 acceptance or release
qualification. Exact-value shielded guards and the immutable ACC binding remain.
