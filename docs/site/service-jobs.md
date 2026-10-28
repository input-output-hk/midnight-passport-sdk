---
layout: default
title: Durable host mutation jobs
permalink: /service-jobs/
---

**Unreleased source work for #233.** This opt-in Node API is local milestone work.
Published RC5, the default demo and the legacy `/v1/jobs` protocol are unchanged.
Dated local native-proof results are scoped below; browser-provider and full Lace
qualification remain open.

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
| `POST /v1/host-jobs/start` | `{jobId, identitySha256?}` | `202 {jobId}` after single-start claim/admission, without waiting for proof/finality |
| `POST /v1/host-jobs/reconcile` | `{jobId, identitySha256?}` | `202 {jobId}` for explicit same-intent continuation; no new execute |
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

Status includes `identitySha256`, `state`, public `milestones`, bounded `events`, `cursor` and
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

## Enable jobs in the reference service

Unreleased source now composes this API in `apps/passport-service` when explicitly
configured. Keep the existing three `PASSPORT_HOST_MUTATION_*` settings from the
[host guide]({{ '/host-durability/#enable-the-node-reference-host' | relative_url }}),
then supply **all three** job settings:

| Setting | Meaning |
| --- | --- |
| `PASSPORT_HOST_JOB_DIR` | Dedicated private `0700` job journal directory; distinct from and not nested in the host journal |
| `PASSPORT_HOST_JOB_KEY_FILE` | Owned private regular file with a dedicated 32-byte lowercase hex encryption key |
| `PASSPORT_HOST_JOB_TOKEN_FILE` | Owned private regular file with a dedicated 32-byte lowercase hex operator RPC token |
| `PASSPORT_HOST_JOB_MAX_JOBS` | Unique identity capacity, default `128`, maximum `4096` |
| `PASSPORT_HOST_JOB_MAX_ACTIVE` | Per-process scheduled job limit, default `8`, maximum `128` |
| `PASSPORT_HOST_JOB_EVENT_LIMIT` | Retained events per job, default `32`, maximum `256` |
| `PASSPORT_HOST_JOB_COMPLETED_TTL_MS` | Public result visibility in milliseconds, default `600000`; zero hides completed results immediately |

All four host/job key and token values must be independent of each other and of
the sponsor seed. Key/token files cannot be symlinks or group/world accessible.
Canonical journal paths cannot alias or nest. Keep the same private files on
restart; do not overwrite existing key material to fix a startup error. A partial
job configuration fails startup; omitting every job setting leaves jobs disabled.

With those environment variables set, use the usual Nix service/demo launch.
`GET /healthz` advertises `hostJobs: true` only when this composition is enabled;
it does not promise new native or provider qualification. `hostMutations` remains
the separate direct-RPC capability. The default demo does not select job ports.

The direct host RPC and jobs share the same executor, wallet queue and
`PASSPORT_MAX_DEPLOYS` budget. A new host deployment registration consumes a slot;
reconciliation of an existing record consumes none. Accepted jobs have not yet
passed that deployment policy. A refusal after the start claim can leave the job
unknown without a host record; retain its original ID. The cap is process-local
and resets on restart. It is **not** a durable spending ceiling. Legacy/v1 sponsor
balance/submit calls now share this queue too; an entire balance-then-submit
session is not made atomic by serialising its individual calls.

On `SIGINT`/`SIGTERM`, the service stops HTTP/job admission and drains accepted
host work and queued wallet calls before closing the journal keys. A second
signal does not start a second shutdown. The process gives draining 30 seconds;
on deadline/failure it exits nonzero and directs the operator to retain original
IDs/journals. A long proof can exceed that deadline. Restart with the same files,
inspect the same jobs and explicitly reconcile; never infer no broadcast from a
shutdown timeout. Legacy callbacks remain process-local even on graceful shutdown.

For an image, mount both writable journal directories under retained state and
four read-only private key/token files accessible to the configured UID. Pass the
same variables with container paths. No image layer or public config endpoint
should contain these values. Published RC5 images do not include this source work.

## Consumer adapter and explicit recovery

The unreleased `mn-passport-adapter-service` root exports `remoteHostJobs`,
`remoteHostJobPorts`, `remoteHostJobId` and their public types. These imports use
WebCrypto SHA-256 without linking Node/service code. The dedicated job token still
belongs in a **trusted operator host or BFF**, not a public browser page.

```ts
import { remoteHostJobPorts } from '@input-output-hk/mn-passport-adapter-service';
import type { MutationPins } from '@input-output-hk/mn-passport-account/ports';

export function approvedHostPorts(base: string, pins: MutationPins, operatorToken: string) {
  return remoteHostJobPorts(base, {
    pins,
    token: operatorToken,
    timeoutMs: 600_000,
    requestTimeoutMs: 10_000,
    pollIntervalMs: 250,
    onSnapshot(snapshot) {
      // Checked public snapshot only; never log keys, descriptors or owner journals.
      console.log(snapshot.jobId, snapshot.state, snapshot.milestones);
    },
  });
}
```

Use these deployer/submitter/outcome ports in the existing
[durable owner composition]({{ '/durability/' | relative_url }}), retaining its
consent, owner journal, frontier checks and source pins. Existing `remoteV1*` and
`remoteHostMutationPorts` are separate opt-in protocols; no fallback is attempted.
This is not a drop-in upgrade for an older running service. Client and service
must both include the new `identitySha256` status field.

A low-level client can inspect or continue a saved public identity without
reconstructing its protected input:

```ts
import { remoteHostJobs } from '@input-output-hk/mn-passport-adapter-service';
import type { RemoteHostJobIdentity, RemoteHostJobOptions } from '@input-output-hk/mn-passport-adapter-service';

export async function inspectThenExplicitlyResume(
  base: string,
  options: RemoteHostJobOptions,
  original: RemoteHostJobIdentity,
  approved: boolean,
) {
  const jobs = remoteHostJobs(base, options);
  const status = await jobs.get(original); // GET only; never drives ledger work.
  if (!approved) return status;
  return jobs.resume(original); // Must follow the host's explicit original-intent approval.
}
```

`execute` sends one accept and one start, then polls GET. It never automatically
reconciles an unknown result or retries a lost POST. `resume` first checks the
saved identity and job status. Under explicit approval it starts an existing
queued job or reconciles a running/unknown job once, then polls GET. Missing and
expired jobs remain unsettled; resume never creates a replacement. A done job
returns its checked receipt without another POST. Reconcile is asynchronous: if
the saved job is already unknown and continuation is slow, `resume` can still
return unknown while that approved work runs. Use read-only `get` polls to collect
its later outcome; an unknown snapshot is not a reason to post another reconcile. Cancellation ends client
waiting; accepted service work continues. Error messages are fixed and contain no
service diagnostics. The total and per-request budgets include response-body
waiting; even a custom fetch that ignores cancellation cannot prolong the client
invocation beyond its deadline.

Each status carries `identitySha256`, the canonical SHA-256 of full pins, request
ID, intent digest and effect kind. Start/reconcile optionally accept this hash;
the new client always supplies it and rejects a mismatched status before any
explicit continuation. The server checks it before scheduling work. Low-level
GET cursors are validated; a stale cursor still requires a fresh snapshot, not
silent event loss. Ordinary waiting reads fresh bounded snapshots, so an event
observer may see repeated events; it receives snapshots, not an exactly-once log.

### Operational use cases and expected results

| Situation | Action | Expected result |
| --- | --- | --- |
| Proxy loses accept reply | Explicitly resubmit the identical descriptor | Same deterministic job ID; no execution merely from accept |
| Start reply is lost | Inspect original identity; approve `resume` if needed | Existing queued work can start; running work is never re-executed |
| Service dies before host registration | Restart same journals and inspect/resume | Unknown; no replacement host execution, even if no host record exists |
| Service dies after broadcasting | Restart and approve same-ID resume | Saved identifier lookup; no rebroadcast; remaining original deployment waves may continue |
| Another intent reuses the request ID | Inspect/continue with its different identity hash | Refused before scheduling; no receipt borrowed from another intent |
| Job is done | Read or resume original identity | Checked public receipt, no new POST/effect |
| Completed result expired | Inspect original identity | Expired/missing public outcome; ID and capacity remain reserved |
| Client cancels or times out | Keep owner intent and original ID | No cancellation/no-send assumption; inspect and explicitly reconcile |
| Sponsor queue or deployment policy refuses | Keep the unknown job and inspect host state | No automatic retry, new identity or renewed transaction |

### Repeat the transport end-to-end checks

From a built source checkout inside Nix:

```sh
nix develop -c pnpm run build
nix develop -c node --test tests/remote-host-jobs.test.mjs tests/host-jobs-http.test.mjs tests/host-jobs-process.test.mjs
nix develop -c pnpm --filter passport-service exec node --import tsx --test test/host-jobs-config.test.ts test/host-jobs-e2e.test.ts
```

The last command starts ephemeral loopback subprocess services, hard-kills only
those children at recorded boundaries and reopens their encrypted journals. It
covers P-256/Jubjub × call/deploy × before-host/after-broadcast: eight restart
cases. Pre-host cases stay unknown with zero sends; after-broadcast cases preserve
the original receipt, send no duplicate and may finish remaining deployment waves.
The tests provision only synthetic private keys/receipts and remove their own
temporary directories. Docker, live wallets, existing user accounts and retained
native fixtures are untouched. This is service transport qualification; native
proofs, provider ceremonies and actual released-image qualification remain open.

## Native proof and local image qualification

Two opt-in suites extend the synthetic transport checks. Read the
[live qualification guide]({{ '/live-qualification/' | relative_url }}) before
controlling the dedicated localnet. Use fresh private `PASSPORT_LIVE_ROOT` paths,
the existing pinned contract export and the same retained localnet volumes.
`PASSPORT_RC_LOCALNET=1` and `MN_NETWORK_ID=undeployed` are required.

```sh
nix develop -c pnpm qualify plan host-jobs-native
nix develop -c pnpm qualify run host-jobs-native --output /private/evidence/host-jobs-source-suite.json
```

`host-jobs-native` uses actual native proofs and software owner credentials,
with a dedicated instrumented host process. It exercises original deployment and
activation submit/reply loss, real indexer stop/unknown lookup, prover failure
before the next committed deployment step and explicit original continuation.
A final owner proof fails before host registration and remains safely unknown;
it must not add a job, prepared transaction or broadcast on resume.

`host-jobs-image-native` runs the locally built **production service entrypoint**
with `PASSPORT_NATIVE_JOB_IMAGE=sha256:…` and
`PASSPORT_NATIVE_JOB_DEPS_VOLUME=mn-passport-hostjobs-20261027-linux-deps`.
Build from the exact committed qualification source and label the image with
`org.opencontainers.image.revision`. Keep the contract export read-only and overlay
its `node_modules` with a separately prepared Linux dependency volume. The
reference lockfile stays pinned. Do not mount macOS dependencies into Linux.
The local qualification uses `linux/amd64`, including emulation on an arm64 host;
that platform is part of its receipt.

Provision four independent private synthetic files and non-nested job/host
journals through the fixture preparation stage. The image runs as a non-root
UID/GID matching those private bind files, with read-only key/token mounts and
retained writable Linux state volume. It restarts the same exact owned container after native
deployment and owner-call boundaries, then completes and opens the original ACC.
The runner refuses an existing container name or fixture destination. Failed or
unknown roots remain preserved for inspection; they are never replaced/replayed.

Native image evidence counts authenticated **durable dispatch claims and included
identifiers**. The source harness separately instruments submit-entry attempts.
Neither is silently substituted for the other. Both suites pin signed source,
compiled runtime and reference fingerprints before execution and audit them at
the end. No source/build edits while they run. Private constructor/signing/owner
state stays outside Git and the knowledge base; export only reviewed public/hash
summaries. Actual results must be read from their dated receipts; the existence
of these suites is not a pass, real-provider or released-image qualification.

A call-side owner flow can wrap the low-level job adapter's unsettled error in
its existing `InternalError` scoped-transaction envelope. The owner journal still
retains the original unresolved effect. Qualification matches the declared
operation/fault/arm-specific SDK code, not an arbitrary exception. Never infer
no submission from an error category; inspect the original journal and ledger.


### Image state filesystem and observer

Use a fresh `PASSPORT_LIVE_ROOT` whose final component is `image-v1` through
`image-v999`. The runner creates separately labelled container/state-volume names
for each arm and refuses existing names. It provisions only the fresh volume,
checks the Docker-managed ext filesystem, then tests two durable CAS revisions as
the non-root service user before starting the production entrypoint. The volume
and all original unknown fixtures remain available after failure or cleanup.

Encrypted immutable journal revisions are copied read-only to the private host
fixture for inspection. Every observation checks hashes against the Linux source;
missing/replaced history, unsafe paths, modes, symlinks and corrupt copies fail.
These observer copies never drive work. Back up the retained Linux volumes as
well as the protected owner fixture; a copy is not a restart journal.

A 2026/10/27 macOS bind-state attempt failed before publishing its initial host
revision, leaving an accepted job unknown and an uncommitted temporary file. The
exact initial storage failure cause was not established; independent
scratch CAS writes passed. That attempt is a failure, not evidence for macOS
shared-folder durability. This image qualification requires Linux volume state;
macOS bind-mounted durable state remains unqualified. Missing host state still
never authorises replacement or a new send.


### Recorded local acceptance — 2026/10/27 UTC

Both P-256 and Jubjub passed the source/native-proof sequence (12 cases) and
production-entrypoint Linux-volume Docker sequence (six cases). Each original
created account completed and reopened after its declared interruptions. Each arm
has four completed create-related host jobs and 13 confirmed steps. Separate
before-registration owner-proof failure fixtures intentionally remain unknown.

Source-native evidence is pinned to signed `0f90ab0`; local image evidence to
signed `c128b3c`, with all 291 production source/runtime files identical. The image
ID is `sha256:ea189f3f7214e6c09e1734a1921efe46f0fbe0ebee6341ddc8baf864358deeda`
(`linux/amd64`, emulated on arm64). The reference lock and nine selected package
entry/version/integrity pins match. See repository
`docs/review/native-host-jobs/README.md` and its machine-readable receipt for
job/transaction hashes, snapshots, mount metadata and earlier failed attempts.

Source submit-entry counters are distinct from image durable dispatch claims and
included identifiers. Image owner-worker local journal summaries may lag; final
fresh Linux-volume exports establish the host state. Preserve both the actual
Linux state volume and the separate protected owner fixture/keys when backing up;
read the volume as the service UID/GID. Never resume from the observer mirror.

This acceptance covers creation/activation/inbox continuation. Job-backed device
lifecycle with grants/holdings and wallet reconnect, real providers and full Lace
integration remain separate. No new package or image has been published; RC5 does
not include this opt-in API. Broad #233/#231 and existing release limits stay open.


## Job-backed populated lifecycle qualification (unreleased)

Two additional opt-in suites cover the device lifecycle with an independently
enrolled survivor, one active caller-pinned read grant and one qualified mock
shielded holding, followed by wallet reconnect. Their existence is not a pass;
read repository `docs/review/job-backed-lifecycle/README.md` and dated receipts.

```sh
nix develop -c pnpm qualify plan host-job-lifecycle-native
nix develop -c pnpm qualify run host-job-lifecycle-native --output /private/evidence/lifecycle-source-suite.json
```

Use the same required localnet/network/contract variables as above and a **fresh**
private `PASSPORT_LIVE_ROOT`. The source lane exits after native target enrollment,
removal/key rotation and survivor rotation submission, stops the actual indexer
for an unknown-outcome probe, then resumes the original intent. It must preserve
holdings, current-reader access and the read grant after every completion.

`host-job-lifecycle-image-native` selects a separate **Linux/arm64** profile,
actual production service entrypoint, Linux ext state volumes and locked Linux
reference dependencies. Set `PASSPORT_NATIVE_JOB_IMAGE` to the image ID built from
the exact clean signed source, with its revision label, and
`PASSPORT_NATIVE_JOB_DEPS_VOLUME=mn-passport-joblife-20261028-linux-deps-arm64`.
The cache label must be `passport.qualification=job-lifecycle-20261028`. Prepare it
with `npm ci` from the pinned reference lock, not macOS dependencies. Fresh roots
end `image-v1` through `image-v999`; new containers/volumes use the separate
`mn-passport-joblife-20261028` namespace.

The image lane interrupts the software owner's observation of a **confirmed**
original target job, then kills/restarts the same production container and
retained volume before same-ID continuation. It does not claim a pre-submission
kill. A current-intent/circuit-bound receipt is required; an old completed job,
foreign intent or arbitrary error cannot establish the boundary.

After removal and survivor rotation, the removed target must fail with a
reachable host and zero host/job mutation. Its historical disclosed key remains
readable. The built-in wallet uses the same synthetic account owner's key-source
seed, reconnects through a real indexer outage and observes a standalone payer's
two-smallest-unit NIGHT transfer. Recreating it must retain addresses/balance,
refuse stale handles and close subscriptions; grant/holding checks run again.
This establishes software owner continuity, not real passkey-provider recovery,
full Lace integration or ACC viewing-secret-to-HD derivation.

Population grant/mint/deposit and the wallet credit are standalone setup, not
job-backed effects. Stop the sponsor host before each standalone payer. Native
proof suites have a bounded 180-minute budget and stay outside fast CI. All
original private fixtures and actual Linux state volumes must be retained on
failure; never resume from an observer copy or replace an unknown intent.


### Partial lifecycle run — 2026/10/28

The new source suite is **not qualified yet**. At signed `a4c3d4f`, Jubjub creation,
standalone grant/holding setup and survivor enrollment completed. Target
enrollment crossed its native post-submit/reply-loss boundary and real indexer
unknown-outcome probe; host capacity then fell below the 2 GiB guard before
original-ID recovery. The original running job/intent and prepared bytes remain
retained. Final snapshot: 22 jobs, 31 single dispatch claims, 30 confirmed steps;
31 instrumented source submit entries without repeated prepared-byte entries.
This is partial evidence, not full enrollment recovery or complete lifecycle
acceptance. P-256, removal, survivor rotation, reconnect and ARM64 image cases
remain pending. The local ARM64 image passed byte/dependency checks only.

Repository `docs/review/job-backed-lifecycle/qualification.json` preserves the
failed aggregate verdict and exact pins. Free at least 15 GiB before restarting
native qualification, verify Docker/owned container state and retain the failed
root. Reconcile only the original target intent; a fresh complete test uses a new
root. Never turn a missing receipt, capacity stop or skipped lane into a pass.
