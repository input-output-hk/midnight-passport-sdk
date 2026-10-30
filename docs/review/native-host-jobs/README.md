# Native host jobs and local image restart qualification

Refs #233/#231. Scope: current branch, fresh software identities on retained
`mn-passport-qual-20261023` localnet; immutable `acc-s3r1.1` and existing keys.
This review map describes the harness. A passing receipt is separate evidence.
No provider, full Lace, package publication or release acceptance is implied.

## Review order

1. `scripts/qualification/native-job-evidence.mjs`: private encrypted synthetic
   journals to public hashes/milestones, authenticated historical revisions,
   immutable constructor/input/prepared bytes and one durable dispatch claim per
   step. Latest-only observation is labelled unaudited and cannot qualify history.
2. `live-host-jobs.mjs`: only exact dedicated container IDs/labels/ports, fresh
   roots, bounded child groups/output, strict failure/crash/handshake checks,
   two declared arms, source/reference freeze and end audits. Preserve every
   failed/unknown fixture. No reset/replay/replacement.
3. `apps/passport-service/qualification/live-worker.ts`: additive explicit job
   mode, separate keys and 24-hour synthetic result visibility, actual remote
   job ports/native backend; same original owner journal/approval on resume.
   Existing direct profiles retain their pins. Flush final pipe output on exit.
4. Image lane: actual production entrypoint, independent Linux npm-ci reference
   dependency volume overlay, read-only contract/key/token mounts and retained
   writable synthetic state on a fresh retained Linux volume. Non-root UID/GID matches private bind files.
   Local Linux/amd64 image on an arm64 Docker host is explicitly emulated.
5. Cheap negative tests validate corrupted/missing historical records, immutable
   source/effect comparisons, no protected payload in summaries, and strict error
   matching. Slow native suites remain opt-in, outside fast required CI.

## Declared cases

Source: create crosses deployment post-submit/pre-ack crash → actual indexer
unknown lookup → committed maintenance proof/prover outage → original resume →
activation post-submit crash/indexer probe → same-ID completion. Final owner proof
outage happens before host-job registration; resume must remain safely unknown
with unchanged job/host records and sends. Both P-256/Jubjub; no real passkeys.

Image: fresh create through production service entrypoint crosses observed native
deployment-wave and owner-call dispatch boundaries with exact container KILL and
restart, same IDs/journals/mounts, then completes and opens the original account.
Container observations establish immutable dispatch claims and confirmed included
identifiers. Only the source harness instruments actual submit-entry attempts;
never label image claims as a separate instrumented network-attempt counter.

Receipts will name exact signed source, ignored compiled inputs/reference hashes,
image ID/platform/mounts, elapsed times, public milestones and limitations. Missing
inputs, unexpected exits and failed native runs never become successful passes.

The native classifier reuses the established exact SDK mapping: deployment
reply/prover loss and explicit unknown resume report `MutationUnsettled`; scoped
owner-call submission/proof exceptions have the existing `InternalError` envelope.
Require a single matching failure, no completed operation, and one unresolved
original effect. A generic exception or incorrect crypto arm must not pass.
The image owner uses normal same-ID software-approved continuation while inclusion
is pending; only the actual externally controlled container kill ends that stage.


The image observer mirrors only hashed immutable encrypted revisions; the service
never uses the mirror. Review `image-journal-mirror.mjs` and its rejection tests.
State volume preparation is isolated; native ext filesystem and non-root CAS
preflight precede main. Signal-only child exit must terminate a boundary wait.
The failed macOS bind-state attempt remains unqualified, separately retained; no
claim is made that a filesystem failure was repaired by replacing an original job.


## Native proof and production-image evidence — 2026/10/27 (UTC)

Both declared arms passed the native and Linux-volume image cases. These are local
qualification results for unreleased descriptor-based host jobs. Published RC5,
real passkey providers and full Lace integration are outside this acceptance.

| Lane | Signed source | Passed cases | Evidence |
| --- | --- | --- | --- |
| Instrumented source/native proof | `0f90ab04f307a445cace3bfec60859b32a6f78fc` | 12 | Both arms: deployment/activation reply loss; real indexer outage probes; committed deployment proof outage; original create/reopen; failed owner proof before registration remains unknown; submit-entry/history audit. |
| Production entrypoint / Docker | `c128b3c5a34fb3165b2510a9ff9edd2b66b713f2` | 6 | Both arms: deployment boundary KILL, owner-call boundary KILL, same-container/volume continuation to the original completed/open ACC. |

Each arm has four completed create-related host jobs and 13 confirmed host steps.
Separate pre-registration owner-proof failure intents intentionally remain unknown. Source records
13 instrumented host submission entries and zero duplicate prepared-byte entries
per arm. The image establishes single durable dispatch claims and included
identifiers; it does not independently instrument network submission attempts.
The owner worker's local journal summaries may lag its Linux service; only the
final fresh Linux-volume export supplies image host acceptance.

The image is local `linux/amd64`, emulated on `linux/arm64`:
`sha256:ea189f3f7214e6c09e1734a1921efe46f0fbe0ebee6341ddc8baf864358deeda`.
It uses the actual production entrypoint and non-root service user, one writable
Linux ext state volume, read-only contract/reference dependency/key/token mounts,
and an independently prepared pinned Linux reference dependency cache. All 291
production source/runtime files match across the two signed sources and image;
the reference lock and nine selected package entry hashes/version/integrity pins
match. Source/runtime/reference inputs stayed frozen for each run and passed end
audits. No proving keys were regenerated.

Earlier attempts remain failures: source v1 exposed strict service-pin projection;
source v2 exposed the existing scoped `InternalError` envelope; image v1 left an
accepted deployment unknown before host revision publication on macOS bind state.
The exact underlying storage failure was not established; no failing syscall
was identified. Its temporary
file and original unknown job remain retained; independent scratch CAS passed.
Image v2 uses Linux volume state with a non-root two-revision CAS preflight.
**macOS bind-backed durable image state remains unqualified.** A missing record
never permits replacement or a new send. Signal-only child exit detection was
also corrected and covered by a negative control.

See [machine-readable evidence](qualification.json) for exact source, input,
job/transaction hashes, final snapshots, mount/volume metadata and failed-attempt
summaries. Full reviewed public/hash receipts are indexed in the private owner
knowledge base. Authority/owner state and raw native diagnostics stay in protected
synthetic backups outside Git and the knowledge base.

The full local gate passed 976 tests, seven existing conditional skips and zero
failures before image qualification. Final documentation verification is recorded
in the [verification receipt](verification.json). Slow native suites are opt-in, outside fast
required CI; the new mirror/failure controls run in the ordinary test suite.

Broad #233/#231 and release/provider limits remain open. This flow does not qualify
job-backed enrollment/removal with grants and holdings, wallet reconnect, an
automatic scanner, a distributed wallet lock, persistent budget, unknown/no-send
repair, or journal compaction. The existing exact-value shielded withdrawal guard
is unchanged. No package/image/docs publication occurred.
