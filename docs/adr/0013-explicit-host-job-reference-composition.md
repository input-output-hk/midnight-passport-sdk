# ADR 0013 — Explicit durable host-job reference composition

Date: 2026/10/27. Status: accepted for unreleased source. Refs #233, #231, #234.

## Context

The provider integration checklist requires SDK retries to be idempotent across
multi-minute proofs. The first #233 slice supplies immutable descriptor-based
host jobs over the existing write-ahead executor. A process-local work closure
cannot supply a restart contract. Reference-service wiring and consumer ports
must preserve the original owner approval, native validation and sponsor policies.

## Decision

Keep `/v1/jobs`, `remoteV1*` and `remoteHostMutationPorts` intact. Enable
`/v1/host-jobs` explicitly with independent private configuration. Share one host
executor, wallet queue and process-local deployment budget with direct host RPC.
All legacy/v1 sponsor balance/submit calls also use this wallet queue; they
previously bypassed it. This serialises individual wallet calls, without claiming
an atomic balance-then-submit session or a cross-process wallet lock.

Add a public SHA-256 of the full job identity to status and an optional expected
identity hash to start/reconcile. The new client always checks/supplies it. This
is additive within the unreleased host-job protocol, without changing the ACC,
legacy wire version or release package versions. A future publication must pin
client/service versions that both support this field. Original input hashing
and immutable host journals remain separate protections.

`remoteHostJobs` polls read-only snapshots, validates public fields and final
receipts, and never retries a POST automatically. `remoteHostJobPorts` exposes
existing owner deployment/submission/outcome ports. Explicit owner-approved
reconciliation can start an existing queued job or continue its original host
record. It never accepts a missing job, serialises a callback, regenerates keys,
rebuilds a transaction or falls back to a different protocol.

Use a dedicated operator token in a trusted host/BFF. Browser-safe imports mean
portable code; they do not make a bearer token safe in a public dApp. The reference
demo keeps its existing flow until a separate owner composition is adopted.

Drain admission, HTTP handlers and accepted job/queued wallet work before closing
encryption keys. A 30-second process shutdown deadline exits nonzero with explicit
unknown-outcome guidance. Preserve journals and original IDs on forced termination.

## Consequences and acceptance

Acceptance is durable scheduling, not funding approval or ledger finality. A budget,
queue or preparation refusal after a job claim can remain unknown without a host
record. No authoritative no-send/failed terminal state is added here. The existing
deployment budget resets on process restart; it is not a persistent spending cap.
Retain deduplication IDs and private immutable history after public result expiry.
No automatic scanner, compaction, rollback detection or distributed wallet policy.

Fast CI runs real HTTP, encrypted files and hard-killed/restarted reference-service
processes over synthetic chain drivers, for both schemes and call/deploy effects.
These establish transport/restart behaviour, not native proofs, passkey providers,
full Lace compatibility or release acceptance. Keep slow native and actual image
qualification as separately pinned evidence. Broad #233 remains open.
