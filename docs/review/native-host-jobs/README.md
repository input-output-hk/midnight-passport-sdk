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
