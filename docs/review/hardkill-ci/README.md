# Hard-kill reconciliation and CI timing

This source-preview slice follows the release acceptance tools in PR319. It
changes repository qualification and CI tooling, not installed SDK APIs, the
contract binding, authorization policy or immutable RC9 artifacts.

## Intended result

For #313, retain a durable identity for the source SDK process before it can
perform account work. A separate explicit reconciliation command can close that
exact process after its controller is killed, stop only recorded Docker compute,
check the original input snapshot and release only the original lease. It must
never rerun creation, deposits, account recovery or an original request.

For #271, retain measured hosted run/job/step/cache timing and bound dependency
metadata work. Missing, malformed or unavailable metadata must fail the cooldown
gate rather than silently skip a package. No assertion, dependency quarantine or
cache-integrity requirement is removed to meet a latency target.

## Process custody

- The controller fsyncs a fresh launch intent before spawning. The worker fsyncs
  its own PID, UID, process group, executable/command identity and kernel start
  identity before admitting an authenticated controller GO and importing the
  selected source client. Ready/GO is a barrier, not an inferred authentication.
- Linux uses `/proc` process start/boot identity; macOS uses bounded `ps` queries
  with the exact executable/command and a unique per-launch argument. These are
  observational evidence, not an atomic signaling capability or an identity API.
  Reconciliation never calls kill(pid) or kill(-pgid): a private authenticated
  local channel asks the original worker to exit itself. Missing/unresponsive
  control retains uncertainty; PID observations cannot authorize an OS signal.
- Process records and original operation fixtures have separate files and one
  writer each. No secret, fixture content or wallet credential enters identity
  metadata. The process wrapper runs the client in its own process, without
  starting a second wallet or resuming an account operation.
- A live controller refuses reconciliation. Missing acknowledgements, reused
  PIDs, mismatched commands, unknown group members, unsafe files, input drift,
  daemon changes and incomplete cleanup retain uncertainty and the native lease.
  Do not signal a process merely because its PID or a name matches. Challenge
  responses bind a fresh nonce to the original launch and worker identity; keep
  the control capability separate from redacted metadata and wallet fixtures.
- A recovery controller obtains an exclusive private reconciliation claim,
  validates an independently pinned original journal and its recorded lease
  inode/content identity, then controls only admitted recorded resources.
- Reconciliation writes a new receipt; the interrupted functional run remains
  interrupted. Safe cleanup is not a functional PASS, transaction rollback or
  permission to replay. A second operator cannot race the first reconciler.

## Timing and metadata

- Collect existing hosted metadata read-only with bounded calls and complete
  pagination. Record run ID/attempt, head, workflow path/hash, job/step intervals
  and queue/registration separately. Preserve original raw inputs privately.
- Admit cache warmth only from observed cache evidence; never infer it from a
  short install. Unknown, fallback and cold cache states remain distinct. Report
  all jobs and separate image/cold costs from substantive warm-job measurements.
- Repeated warm-target acceptance needs at least three matching source/workflow
  samples and every required job. Historic or mixed-head observations are a
  baseline, not proof that unpublished changes meet 30–45 seconds.
- Deduplicate new lockfile package versions and metadata requests by package.
  Bound concurrency, retries, response bytes and both request/overall deadlines.
  Registry redirects, invalid/missing/future publish dates and failed fetches
  cannot become safe age assertions. A security override can acknowledge a
  known recent version; it cannot replace missing metadata.
- Do not add a metadata or compiled-output cache without independently reviewed
  trust/invalidation rules and corruption tests. Keep the existing frozen
  dependency downloads, fresh builds and exhaustive required test inventory.

The trusted prototype dependency warmer uses the existing public download-store
identity. Input admission, isolated npm config, disabled lifecycle scripts, a fresh
frozen install and independent SHA-512 checks of every pnpm10 content-addressed
file precede use/save. A synthetic corruption experiment showed why pnpm's flag
alone is insufficient; shared PR preparation now uses the independent checks too.
CAS layout is not lockfile provenance. It caches no workspace outputs or private registry packages. Its hosted
effect remains unmeasured until a later authorized push.

## Code and test map

| Boundary | Sources | Deterministic tests |
| --- | --- | --- |
| Immutable launch, worker identity, authenticated ready/GO and self-exit | `scripts/release/process-*.mjs` | `tests/release-process.test.mjs`, synthetic child fixtures |
| Original journal/lease custody and exclusive no-replay recovery | `scripts/release/reconcile-*.mjs`, `reconcile.mjs`, mounted integration | `tests/release-reconciliation.test.mjs`, existing resource/mounted tests |
| Bounded complete dependency age | `scripts/ci/metadata.mjs`, `lock-versions.mjs`, `cooldown.mjs` | `tests/ci-metadata.test.mjs` |
| Public download cache trust | `scripts/ci/public-cache.mjs`, trusted warmer workflow | `tests/ci-cache.test.mjs` |
| Whole-job/cache timing and exhaustive advisory profiles | `scripts/ci/timing.mjs`, collector, package reporter/admission/planner | `tests/ci-timing.test.mjs`, `ci-profile.test.mjs` |

The eight browser cells and four existing Node shards are preserved. New workflow
artifacts are observation only; package reporter failures fail the job. Public
operator commands live in the release acceptance guide and CI policy; private
native/process receipts and checkpoint packets are separate from partner docs.

## Review and evidence plan

Deterministic tests run in the normal unit inventory. Use fresh private roots for
actual parent-SIGKILL process tests, including before acknowledgement, during
work, process exit, identity substitution and interrupted reconciliation. Tests
must prove no replacement operation, no unowned signal and retained uncertainty.

The opt-in mounted experiment uses the pinned production images, prepared Linux
dependencies, existing 15 GiB disk/24 GiB Docker memory guards and an isolated
chain. It freezes inputs across the killed controller and its reconciler. All
original IDs, fixtures, stopped containers and state volumes remain preserved.
Do not contact a user's existing account or stop an unrelated stack.

Run the complete local gate before each signed/DCO commit; workflow changes also
need pinned actionlint. Review the exact committed head independently. Retain
redacted results and signed checkpoints privately. Hosted acceptance of new local
changes requires a later authorized push; no source-only timing claim closes
#271 or establishes native/provider/full Lace compatibility.
