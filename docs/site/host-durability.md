---
layout: default
title: Durable host submissions and deployment waves
permalink: /host-durability/
---

**RC6 preview host transport following the owner continuation API.** See the [RC6 release status]({{ "/release-notes-rc6/" | relative_url }}). This page describes
the opt-in Node host transport for [mutation durability]({{ '/durability/' | relative_url }}).
Published RC5 and the default demo owner buttons are unchanged. Docker was stopped
during this slice: offline/process tests do not establish proof-backed localnet,
real-provider or full Lace acceptance.

## What the host persists

`createHostMutationExecutor(store, driver)` from `mn-passport-service` records:

- Original network, `acc-s3r1.1` manifest, authoriser arm, owner mutation request ID
  and intent digest, together with immutable original input and retirement choice.
- A committed deployment plan: the original randomised deployment transaction,
  address, complete initial state, ordered verifier waves and maintenance signing key.
  Constructing `ContractDeploy` again would change its address; resumption uses the
  original saved transaction.
- Every prepared finalised transaction's **exact bytes and watch identifiers**, before
  broadcast, followed by its submission ID and successful included transaction hash.
- A revision/owner fence. A stale preparer cannot claim dispatch after a successor has claimed the
  record. Already dispatching/sent steps are looked up, never sent again; an
  in-flight dispatch may still settle after takeover.

`encryptedHostMutationStore(directory, key)` stores these records with AES-GCM over
the existing private, fsynced, immutable-revision POSIX byte store. Associated data
binds identity, pins and revision. Authority material and raw transactions never
appear in the HTTP outcome/audit responses. Wrong keys, changed digests/pins,
malformed versions and corrupt latest records fail closed. Calling `close()` erases
the store's copied service-key buffer; JavaScript strings/objects do not promise
secure memory erasure. Filesystem rollback/deletion by an operator requires an
external trusted revision anchor; it is not detected by this reference store.

The host encryption key is **independent of** the sponsor seed and client passkey.
Back up that key and journal under the host's protected operations policy. Losing
it can prevent deployment maintenance from continuing; it does not regenerate an
ACC viewing key or create a replacement contract.

## Enable the Node reference host

The service requires all three settings, or none:

| Setting | Meaning |
| --- | --- |
| `PASSPORT_HOST_MUTATION_DIR` | Dedicated private host-journal directory, mode `0700` |
| `PASSPORT_HOST_MUTATION_KEY_FILE` | Private regular file containing 32-byte lowercase hex encryption key |
| `PASSPORT_HOST_MUTATION_TOKEN_FILE` | Different private regular file containing an independent 32-byte lowercase hex RPC bearer token |

Key/token files must be private (`0600`, no symlinks), owned/readable by the service
user. They must not contain the sponsor seed, funding token or each other's value.
Do not regenerate existing files on restart. In a container, retain the same
writable journal mount and private key/token mounts across restarts, accessible to
the configured service UID; do not publish these mounts or put them in build layers.

For a **new, otherwise empty** private configuration, an operator can provision:

```sh
install -d -m 700 /private/passport-host
(umask 077; set -C; openssl rand -hex 32 > /private/passport-host/encryption.key)
(umask 077; set -C; openssl rand -hex 32 > /private/passport-host/rpc.token)
```

`set -C` prevents overwriting existing keys. Supply the paths alongside the normal
pinned service configuration, then use its normal Nix launch command. `/healthz`
reports `hostMutations: true` only when configured. Run one service process per
sponsor wallet. The deployment eligibility log is fsynced before a completed
deployment is acknowledged. This flag means the route is
enabled, not that a proof-backed deployment has been qualified.

## Compose trusted host ports

`remoteHostMutationPorts` from `mn-passport-adapter-service` returns `deployer`,
`submitter` and `outcomes` ports. Use them with `createDurablePassportMutations`:

```ts
import { remoteHostMutationPorts } from '@input-output-hk/mn-passport-adapter-service';
import { createDurablePassportMutations } from '@input-output-hk/mn-passport-account';
import type {
  PassportPorts, MutationPins, MutationJournal, MutationConsent,
} from '@input-output-hk/mn-passport-account/ports';

export function hostOwner(
  ports: PassportPorts,
  pins: MutationPins,
  token: string,
  serviceUrl: string,
  journal: MutationJournal,
  consent: MutationConsent,
) {
  const host = remoteHostMutationPorts(serviceUrl, { pins, token });
  // The injected chain must use host.submitter; createMidnightChain forwards
  // request.mutation, address and circuit only to the submission seam.
  return {
    submitter: host.submitter,
    connect: (chain: PassportPorts['chain']) => createDurablePassportMutations({
      ports: { ...ports, chain, deployer: host.deployer },
      journal, consent, outcomes: host.outcomes,
    }),
  };
}
```

The caller still owns authenticated approval of the original owner intent on every
invocation. A host `reconcile` request may continue the remaining **original**
deployment waves after confirming earlier ones; it must only run under that approval.
It cannot replace constructor output or broadcast an uncertain previous step again.

Keep the token in the trusted wallet/host boundary. Do not inject it into an
untrusted DApp, a public `VITE_*` variable, exported operation log or shared cache.
Custom fetch/logging adapters must redact authentication headers and protected
request bodies. The library's default fetch does not log them. This service-key
transport is not a new hosted-signing permission and does not widen Lace consent.

Only the opt-in submitter is durable. The optional context on `Submitter.submit`
contains `{ mutation, address, circuit }`; old submitters remain source compatible
and can ignore it, but then do not supply host receipt persistence. Proving-service
metadata does not receive the mutation correlation. The opt-in deployer/submitter
refuse calls without this correlation instead of falling back to legacy routes.

## RPC and state machine

All routes require `Authorization: Bearer <64 lowercase hex>` and JSON. Existing
Host/CORS checks remain; `authorization` is an allowed preflight header.

| POST route | Purpose |
| --- | --- |
| `/v1/mutations/execute` | Accept `{ identity, input }` once, or use the matching existing record |
| `/v1/mutations/reconcile` | Accept `{ identity }`; inspect a sent step and continue a committed original plan where safe |
| `/v1/mutations/status` | Read the historical outcome without submitting or advancing |

Identity is `{ pins: { networkId, bindingId, manifestSha256, scheme }, requestId,
intentSha256, kind }`. Request IDs use the owner coordinator's `<32-hex-id>:<step>`
format. Inputs for deployment are hex `boot`, hex `encKey`, explicit boolean
`retireAuthority` and `firstArm`. Owner-call input contains finalised hex `tx`,
`address` and `circuit`. Reusing an ID with a different input/digest/pin refuses.

The reference driver accepts calls only to eligible registered/deployed accounts
whose complete 52-key roster matches the retained binding. It allows activation,
sealed inbox append, encryption-key switch, add-device and remove-device for the
selected arm. Additional actions, value offers, withdrawals, recovery and arbitrary
maintenance transactions are refused. The path does not move tokens itself.

Responses are `200 { kind: 'unknown' }` or `200 { kind: 'confirmed', digest, result }`.
A call result carries included `txHash`, `submissionId` and optional block height;
a deployment result carries its original address and every wave's submission ID.
The remote submitter returns the **watch ID**, while its `MutationOutcomeSource`
returns the account API's included hash/height. These values must not be conflated.
Unauthenticated requests return `401`; conflicting/unsettled executions return a
sanitised `409`. Protected errors, keys, records and raw transaction bytes are not
returned. Disabled routes retain the server's normal `404` behavior.

| Durable phase | Restart behavior |
| --- | --- |
| No record | Unknown. A late original HTTP request might still arrive; absence never proves no send |
| Preparing deployment, no committed constructor plan | Unknown; do not generate a new authority/address implicitly |
| Preparing owner call, original input committed | Explicit resume/reconcile may claim a new fence, revalidate the same already-built input and dispatch it under the original approval; no replacement transaction/authority |
| Active, original plan committed | Claim a new revision fence and resume that plan |
| Ready transaction committed | Recheck the frontier and send the saved bytes once |
| Dispatching/sent transaction | Look up the stored watch ID, including when the submit response was lost. No rebroadcast |
| Confirmed step | Verify the exact installed frontier before preparing the next wave |
| Complete | Return the saved historical receipt; the owner coordinator separately checks its current ACC frontier |

The service deliberately does not turn an absent indexer record, timeout, failed
or partial transaction into a `not-submitted` answer. The generic account port can
express a fenced no-send outcome, but this remote implementation returns unknown
where that stronger fact cannot be proved.

The reference driver resolves the indexer's protocol version through the pinned
Midnight protocol module, decodes the included raw bytes with ledger v9, validates
the stored identifier and included hash, and accepts only `SUCCESS` (entire
transaction). Missing/unknown/older eras, malformed data and partial failures stay
unknown. It queries finality in a bounded read; it does not hang on an uncancellable
watch. The indexer/node remains a trusted chain evidence source, not a light client.

Before each deployment wave, the driver compares the exact contract state against
the original constructor data, expected verifier operations and expected authority
counter/committee. Final retirement must appear **only** in the last wave when the
original caller chose it. Every verifier's bytes match the pinned binding. A changed
balance, data, key, operation or authority stops continuation. Do not advertise a
partial deployment as ready for funding. The authority remains confidential while
live; keeping it live after completion remains the caller's existing custody choice.

## Cancellation, TTL and upgrade limits

A closed/aborted HTTP request stops future work at host boundaries. The host retains
outputs already prepared and records submissions that may already have occurred.
It does not undo a broadcast. An abort in the durable dispatch-before-send window
can remain unknown; neither caller nor host guesses it safe to send again.

Saved transaction TTLs are retained. An expired/rejected transaction must not be
silently rebalanced, re-signed or replaced after entering dispatch. Such cases need
explicit reconciliation. A constructor result lost before its plan commit remains
an unsupported output-loss window. Neither HTTP idempotence nor a journal eliminates
all key-origin/constructor atomicity windows.

Records use schema v1; reference driver markers are `reference-v9-waves:1` and
`reference-v9-owner-call:1`. Unknown record versions refuse. Unknown driver markers
refuse execution/continuation; completed receipts remain historical data and are
returned without re-executing the driver. Incompatible changes
require an authenticated explicit migration and a new version; never reinterpret
saved bytes/context under another driver. Back up the encrypted state and key
before an upgrade, preserve pins, and never delete a record to “retry.”

## Local qualification

The fast lane covers control flow, revision fencing, encrypted persistence,
authentication, HTTP response loss, cancellation and selected fresh-process cases.
Offline runtime tests build the actual pinned constructor and all signed verifier
maintenance updates, check watch-id/raw-hash/era/status negatives and verify exact
key/authority frontiers. A synthetic network is used for the complete host crash
matrix:

```sh
nix develop -c pnpm run build
nix develop -c node scripts/qualification/host-mutation-matrix.mjs /private/evidence/host.json
```

Both P-256/JubJub identities and both original retirement choices are exercised in
new processes. Receipts distinguish safe unknown outcomes from resumed cases and
bind source/runtime hashes. Synthetic transport state and protected journals are
never public artifacts. See the [review map](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/review/host-durability/README.md).

A live node/proof/indexer restart, funded wallet dust/TTL behavior, combined active
read-grant/holding interruption scenarios, and real provider/Lace-host qualification
remain open under #230/#231/#232. This local transport is not a release or full
compatibility claim. The immutable binding and exact-value shielded guard remain.


## Live follow-up

The [live qualification guide]({{ '/live-qualification/' | relative_url }}) defines
source deployment/create/rotation interruption and indexer-restart cases for both
arms, along with exact runtime/image evidence and the separate real-provider matrix.
The original offline evidence above remains historical; consult the dated review
receipt for the follow-up's actual result, rather than inferring a provider or
complete release pass. Native tagged watch IDs retain their full 33 bytes; hashes
and addresses remain 32 bytes.

## Review corrections — 2026/10/23

Unknown lookup-only polls do not claim a new owner revision or copy the full encrypted
record again. A successor claims the preparation fence when preparing another step,
or before revalidating an original call still in `preparing`. The latter claim
precedes driver validation and retains a full encrypted revision even if validation
refuses; it is not a lookup-only poll. Bound explicit retries operationally.
Cancellation before dispatch leaves the ready bytes unsent; the successful dispatch CAS
is the point of no return. Cancellation after it allows that single committed dispatch
to enter submit and prevents later waves. Process death in the remaining fence/send
window is still unknown; no lease, absence or timeout authorises a resend.

The native driver refuses an expired saved constructor intent before proving and an
expired ready transaction before the dispatch CAS. Its bytes are not renewed or replaced.
This avoids knowingly sending an expired transaction; it does not add automatic expiry
recovery. Network latency can still cross an expiry after the last check. Retain original
IDs/journals for operator reconciliation. No operator replacement/rollback API is claimed.
Direct and reconciled deployment receipts now share address, nonempty transaction-ID,
zero nonce, unbooted state, zero device count and original encryption-key validation.

A wave-boundary state lookup that is still behind also writes no claim revision: the
frontier check runs before claiming preparation. The owner's AbortSignal is forwarded
through reconciliation and correlated submission to the host request. A failed explicit
resume with an unknown outcome keeps cancellation set, so another attempt still needs
explicit approval. A cancelled preparation retains computed ready bytes by design;
those bytes may later expire, and no automatic replacement is promised. The native
expiry guard requires ten seconds remaining before proof/dispatch as a minimum margin,
without guaranteeing inclusion latency. The original sixty-second transaction window
is retained because the reference fee/DUST rules constrain it.


## Exact-frontier and preparation limits — 2026/10/26

The coordinator deliberately requires the complete recorded ledger frontier. Even
an unsolicited shielded deposit changes its inbox and can make continuation refuse
permanently, including after a call confirmed. There is no append-only deposit
rebase or general repair API. Ignoring arbitrary new inbox entries could miss a
holding or trust forged metadata; no such relaxation is supplied. Concurrent
account mutation is outside the supported continuation scope. Original journals,
IDs and funds must be retained for explicit operator/binding work (#230).

Owner-call preparation can now retry the original committed input after a transient
read/validation error, under a new CAS fence. An older preparer cannot commit or
broadcast. Missing deployment constructor output remains unknown. This does not
recover a failed owner proof before host registration: the host's absence still
cannot fence a late original request. Expired ready/constructor bytes are not renewed.
A retry is useful only while the original bytes and frontier remain valid.

An ordinary key-origin exception can also leave a running material step unresolved:
a generic throw is not an authoritative guarantee that no original output exists.
Cancellation/exception does not permit replacement generation. Typed host-owned
output recovery or a stronger no-output fence is separate work, not automatic
transient-error recovery promised by this API.

The historical 90-transaction live receipt is pinned to its earlier tested source;
it does not qualify later cancellation/frontier/TTL/preparation changes. Keep dated
source receipts separate, and use subsequent exact-source suites for their own
narrower scope. No full restart or release qualification is claimed here.


## Call preparation contract and remaining test scope — 2026/10/26

`HostMutationDriver.prepare` for calls must validate the original already-built
input deterministically, without proving, rebalancing, new authority or replacing
an intent. The shipped native driver decodes the saved transaction bytes. A custom
driver that builds a fresh call on retry does not satisfy this contract. Deployment
constructor loss is still unknown; this change does not permit regeneration.

Explicit `/reconcile` can continue a call that never committed its prepared plan,
including dispatch under the original approval after native checks. It is not a
universally read-only operation. In contrast, a record with an uncertain broadcast
only looks up its saved identifiers, with no rebroadcast. The owner's ordinary
frontier checks and the host's native validation remain distinct; changed or stale
calls can still refuse/fail and must not become replacements. Keep the original
ID, bytes and protected state. Unknown/pending is never evidence of no send.

The earlier stale-producer regression released the old preparer after the
successor completed. The following slice adds the held-successor interleaving,
preparation refusal and authenticated HTTP combinations. This coverage does not
constitute exhaustive race acceptance or native expiry qualification.


## Preparation/HTTP regression slice — 2026/10/26

New source regressions release a stale preparer while its successor is still held,
using both memory and encrypted-file stores. They require no dispatch until the
successor alone completes, and no fence/write/prepare for conflicting original
call bytes. Persistent preparation refusal preserves its input. A simulated
validation/expiry refusal keeps ready bytes unchanged and sends nothing.

Actual loopback HTTP tests cover fresh-executor reconciliation, auth/pin/input
refusal, sanitised preparation failures, client cancellation and an actual client
timeout during held call preparation. Accepted output remains durable; transport
failure sends one execute request and requires explicit same-ID continuation.
These use a fake chain driver, not native expiry or a new process. Existing
native ledger expiry checks and the dedicated proof/outage lane keep their own
scope. The SDK/host semantics are unchanged; complete race/provider acceptance
is not inferred from these new tests.
