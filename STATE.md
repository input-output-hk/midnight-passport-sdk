# STATE — Midnight Passport SDK

> The committed record of SDK development, maintained by
> `mn-passport-skills:spec-driver` per [`docs/development-workflow.md`](./docs/development-workflow.md) §3.
> Every entry carries its GitHub issue
> ([midnightntwrk/passport](https://github.com/midnightntwrk/passport/issues)).
> Last updated: 2026/10/27. Historical entries below retain their original issue namespaces.

## 2026/10/28 — resumed recovery and canonical indexer readiness

Approved Docker recovery preserved original resources. Explicit same-ID original
enrollment recovery passed at db2fc84: 22 jobs / 31 confirmed steps, no new submits,
holding/read grant/all enrolled readers retained. Source-v1 stays FAIL. Fresh
source-v2 failed after rejection 171: the indexer served a six-hour-old divergent
tip; wallet `isSynced` and the old height-one check falsely admitted setup.
Retain both source-v2 unknown and old indexer data. Fresh cache reindexes the same
canonical node, without resetting chain or keys. New qualification readiness
requires node-finalized hash/height plus a fresh indexed timestamp; cheap negative
controls cover stale/forked data and transport failures. Remaining native cases
are not yet qualified. See the job-backed lifecycle review map.

## 2026/10/28 — partial job-backed lifecycle execution; capacity stop

At GPG/DCO signed `a4c3d4f`, Jubjub creation, standalone read-grant/holding setup
and survivor enrollment passed. Target enrollment hit its native post-submit
host exit and real indexer outage probe. The next restart failed the existing
2 GiB capacity guard, leaving the original target job/intent retained and
unresolved. End source/runtime/reference audit passed unchanged. Final snapshot:
22 jobs / 31 dispatch claims / 30 confirmed steps, 31 instrumented submit entries
without duplicate prepared bytes. Overall native suite FAIL_CAPACITY; recovery,
removal, rotation, wallet, P-256 and ARM image qualification pending. The ARM image
passed only 291-file production byte and nine-package locked reference checks.
Fullgate984pass/7existing skips/0failure before execution; docs21pages/462links.
Protected fixtures backed up with SHA256/gzip CRC. Owned container stop requested,
Docker response pending; verify before reuse. No broad cleanup, no unknown replay,
no publication. Free15GiB before next native run. See the dated partial receipt in
`docs/review/job-backed-lifecycle/` and the Obsidian checkpoint.

## 2026/10/28 — job-backed populated lifecycle qualification harness

Add opt-in source/native and production Linux/arm64 suites for enrolled survivor,
target enrollment/removal and survivor-led rotation with an active caller-pinned
read grant and qualified holding, then owner-seed-pinned built-in wallet reconnect.
Require original-ID continuation, historical/current reader semantics, untouched
private fixture and post-wallet grant/holding checks. Source submit crash and
image confirmed-result observation loss plus actual container KILL are distinct
boundaries. Standalone setup and wallet credit are not job-backed. New negative
controls run in ordinary tests; native suites remain outside fast CI. No native
pass is implied by this harness. See `docs/review/job-backed-lifecycle/README.md`.

## 2026/10/27 — native host jobs and production Docker restart qualification (#233/#231)

Local qualification delivered: 12 source/native cases at signed `0f90ab0` and six
production image cases at signed `c128b3c`, for both P-256 and Jubjub. The original
create completes and reopens. Each arm records 13 source submit entries with zero
duplicate prepared-byte entries, and 13 confirmed image steps with single durable
claims. Source/runtime/reference end audits and 291 production-file hashes match.
The local Linux/amd64 image `ea189f3…deeda` is emulated on arm64 and uses a native
ext state volume. The macOS bind-state failure remains unqualified with its
original unknown retained. No publication, provider or full Lace acceptance.
See `docs/review/native-host-jobs/README.md` and its `qualification.json`. The full
gate passed 976 tests, with seven existing skips. Final docs, cleanup and backup
evidence is in the owner checkpoint. Next is job-backed lifecycle with grants,
holdings and wallet reconnect. Broad issues remain open; historical harness notes
below retain their original scope.

## 2026/10/27 — native host-job/image qualification harness (#233/#231)

Add opt-in source/native and local production-image restart suites over fresh
software owner fixtures, original job/host/owner journals and pinned keys. Private
history inspection exports hashes, dispatch claims and public milestones only;
source send-attempt instrumentation and image inclusion evidence are distinct.
Native results pending at this harness commit. No new binding, provider, release
or publication claim; preserve all historical uncertain fixtures and volumes.
See `docs/review/native-host-jobs/README.md`.

## 2026/10/27 — reference host-job integration (#233), local continuation

Extend signed source655b1cb with explicit reference-service configuration, shared
host executor/queue/deployment budget and bounded graceful shutdown. Add
browser-safe client/owner ports, identity-bound status and explicit same-ID
continuation without POST replay or legacy fallback. Legacy/v1 sponsor calls now
use the shared queue; prior paths bypassed it. Actual configured-service process
restart E2E covers both arms and call/deploy at two boundaries over fake drivers.
See ADR0013 and `docs/site/service-jobs.md`; broad #233 and native/provider/image
release qualification remain open. Local source only, no new publication.

## 2026/10/27 — durable host-job outcomes (#233), local first slice

PR #251 merged at signed merge `6399b30` after green exact-head CI/images and fresh Claude
review; core substantive jobs took 17–39 seconds. Current branch retained. Add descriptor-based
host jobs over the existing host executor, encrypted CAS acceptance/capacity,
single-start admission and explicit unknown reconciliation. Public status is
bounded; terminal expiry retains IDs. Fresh-process and HTTP tests use fake chain
drivers and real files/processes/transports. Legacy callback jobs remain local
and the reference app does not enable the new route. No native/provider, complete
issue or release acceptance is inferred. See `docs/review/host-jobs/README.md`.

## 2026/10/27 — PR251 qualification review corrections

Refs #230, #231, #232. Await crash-marker stdout flush before intentional exit,
require the running crypto arm in fault classification, and diagnose a missing
HTTP abort signal without waiting for a timeout. Real child-process backpressure
and opposite-arm controls cover the fixes. Original native receipts remain at
5d2bf20; no native run is relabelled or fixture replayed. The post-review input
comparison lists the harness/test delta and unchanged SDK execution inputs.

## 2026/10/26 — preparation/HTTP and current outage slice

Refs #230, #231, #232. Current branch retained. New deterministic held-successor
races cover memory and encrypted-file CAS stores, original-byte conflicts and safe
preparation/dispatch refusals. Real loopback HTTP tests cover fresh-executor
reconciliation, authentication, persistent refusal, cancellation and timeout with
original output retention. Explicit integrated both-arm/per-arm survivor outage
profiles add closed fault/error/crash checks and unchanged-send unknown probes.
Signed source `5d2bf2062fab64a40eadee009823e7a69bd70cc6` passed 906 tests with 7 existing conditional
skips and no failures, plus one both-arm native round: 32 entries, 88 confirmed
host transactions, zero duplicate sends, ten indexer-down probes/four prover
stops. Original IDs/plans/bytes survived; the final owner pre-registration
failure remains safely unresolved without host-record/send-count changes.
A deployment-error expectation defect was corrected; its failed original run
and pending intent remain retained. No provider/full Lace, three-run release
or complete issue claim. See `docs/review/preparation-outages/README.md`.
Exact-value guard and immutable binding remain unchanged.

## 2026/10/26 — final qualification review hardening

Refs #230, #231, #232, #239.

Foundation review fixes now reject zero-test skipped-result rows and isolate
scenario children from inherited Node test context, options/preloads and module
paths. Actual test/non-test probes check early-exit preload refusal, a shard that
excludes the only test, exact TAP reporter and repeat validation. The input
comparison in `docs/review/grant-recovery/post-review-inputs.json` preserves the
native evidence's original sources while verifying unchanged SDK/worker/shared
assertions/compiled bytes. These harness changes do not requalify native receipts
at a new head. All old source counts and failed verdicts remain historical.

## 2026/10/26 — scoped grant recovery/revocation evidence

Source milestone #239 now has one native software round per arm: five completed
JubJub entries at `4a45aa0` (overall later FAIL, separately end-audited) and five
P-256 entries with explicit single-arm PASS at `7483786`. Component comparison
preserves identical SDK, worker, shared assertions, compiled/reference inputs;
there is no same-source both-arm CLI PASS. Across scopes: 44 confirmed host
transactions, zero duplicate host sends and 34 direct native owner calls; setup
is excluded. Original-reader fresh-profile reconstruction, independent-reader and
missing/wrong-opening refusal, rotation, selective/all revocation and holdings
passed. See [review/evidence](docs/review/grant-recovery/README.md).

JubJub create/directory reopen saves the verified account record required by grant
APIs. Gate: 889 passed, seven existing conditional skips, zero failures. Four fresh
profiles per arm never load the original grant journal; uncertain failed fixture
state remains protected. Owned qualification containers are stopped with volumes
and artifact caches retained. No total identity loss, native grant crash
continuation, real-provider, full Lace or release claim; exact-value guard and
binding unchanged. Review stack #248 → #249 → #250 awaits final external follow-up
and eligible signed merges; no new release is authorized in this goal.

## 2026/10/26 — host preparation and evidence review correction

Call preparation now retries only its original durable input under a fresh revision
fence; stale preparers cannot dispatch. Deployment constructor loss, expired bytes,
pre-host proof failure, key-origin exceptions and concurrent ledger/deposit changes
remain explicitly unresolved. Do not infer no send or replace unknown output.
Historical 90-transaction evidence predates later corrections and does not qualify
this head. New call-preparation/fence regressions are fast source tests. No binding,
exact-value guard, publication or broad #230 closure changes.

## 2026/10/25 — enrolled survivor and wallet reconnect

Delivered locally on the current branch; no push, merge or publication. Frozen
signed source `094c7f0` passed 21 live entries / 88 confirmed host transactions /
zero duplicate sends in one both-arm software-identity round. Active grants and
seven-unit shielded holdings survived enrollment/removal crashes; original intents,
plans and prepared bytes continued, independently enrolled survivors authorized
rotation, and removed identities refused current access. Actual built-in Node wallet
reconnected after indexer downtime and observed a new two-unit NIGHT credit, then
recreated the same HD identity/balance and closed subscriptions. Stopped wallet
handles now refuse late results/new connections, with race/cleanup regressions.

Full pre-freeze gate: 877 passed, seven existing conditional skips, zero failures; docs check passes. See
[review map](docs/review/survivor-reconnect/README.md) and exact verification receipt.
Removal remains multi-transaction; shared trusted read-opening bookkeeping and
preserved software seed are explicit. No atomic compromised-signer retirement,
real-provider/two-browser, total-loss recovery, full release/Lace or large-inbox
resource qualification. Binding pins and exact-value withdrawal guard unchanged.

## 2026/10/24 — combined populated/prover qualification slice

Current branch retained. Draft stack #248 (stability/consumer foundation) → #249
(owner/host durability) is pushed with GPG/DCO-signed review corrections. The
current branch carries the next combined grants/holdings and prover-outage profile.
The review map is `docs/review/combined-outages/README.md`.

Safety corrections refuse unresolved legacy removal/interleaving, retain bounded
historical decryption candidates without metadata trust, hash compiled runtime inputs,
keep unknown polls read-only, propagate cancellation and refuse expired native bytes.
Exact-value shielded guards and immutable acc-s3r1.1 remain. Accepted scoped evidence: 16 live case entries / 34 host-confirmed transactions,
200 owner + 260 populated + 152 host offline cases. Four actual prover stops and two
indexer/process interruptions; zero duplicate host sends. See the combined review
map and verification receipt. Release/provider qualification and broader issue closure
remain false. Owner pre-registration proof loss safely stays unresolved; no blind resend.

## Current fork iteration — 2026/10/20

- **Baseline:** published `0.1.0-rc5`, release source `9e804867`, prototype/docs `786206cf`.
  Nine packages and three images; release notes describe the supported subset.
- **Local preparation** (Refs #231, #235, #236): preserve the complete fast PR gate,
  add dependency/image-layer caching, isolate bounded public-key qualification,
  validate exact sizes/SHA-256 and reject corrupt cache hits. See [CI policy](docs/ci.md)
  and [ADR 0011](docs/adr/0011-fast-ci-and-coherent-milestone-slices.md).
  Remote timing and cache warm-up await an authorised push.
- **First slice delivered locally:** #227 issue/evidence index, #228 binding/recovery
  audit and retention ADR, #229 entry-removal boundaries and JubJub read-grant exclusion
  parity, #231 tiered harness/closed receipts foundation. See the
  [review map](docs/review/stability-foundation/README.md). Full issue closure,
  candidate binding adoption and broader release/provider qualification are not claimed. Follow with
  remaining host/provider qualification. A required incompatible
  binding/API change moves the next candidate to the 0.2.0 version axis.
- **Consumer slice delivered locally:** #79/#81 current-source/registry entry checks,
  key HTTP profile correction and supported synthetic recognition/device evidence.
  See [consumer review](docs/review/consumer-qualification/README.md); full hosted
  creation/enrollment/value routes retain their explicit limits.
- **Durability slice delivered locally:** #230 opt-in protected owner continuations
  and #239 authenticated published-grant reconstruction/demo fallback. See the
  [review map](docs/review/durability/README.md) and [guide](docs/site/durability.md).
  200 fresh-process crash cases: 158 resumptions, 42 expected safe refusals.
  Missing key-origin outputs, unknown/unfenced sends and conflicting state refuse.
  Host receipt/fencing and multi-wave integration, combined active-grant/holdings
  live-proof/provider interruption qualification remain open. Default demo owner
  buttons have not been silently switched to this API.
- **Host continuation slice delivered locally (2026/10/23):** encrypted host records,
  revision fencing, authenticated opt-in RPC/client ports and reference deployment
  wave continuation. Preserve the original randomised deployment transaction and
  maintenance authority policy; reconcile exact watch IDs/raw hashes without
  uncertain resubmission. 152 synthetic fresh-process cases (108 resumed, 44 safe
  unknown outcomes) and native ledger construction/signature/frontier tests.
  See [host review](docs/review/host-durability/README.md). Docker was stopped;
  live proof/provider and combined fault acceptance remain open. No publication.
- **Live restart qualification follow-up (2026/10/23):** dedicated source suite for
  both-arm deployment/create/rotation, post-submit host death and actual indexer
  stop/start. Preserves original plans/bytes and records runtime/image identities.
  Live work identified native 33-byte tagged watch IDs and a JubJub known-address
  open conflict with write-once directory metadata; both fixes have regression
  coverage. See [live review](docs/review/live-outages/README.md) and its dated
  receipt for actual acceptance. Broader release/provider criteria remain open.
- **Working agreement:** current branch, local execution, coherent 5k–10k-line PRs
  with smaller signed commits; keep the exact-value shielded guard. Milestone research,
  private consumer notes and redacted receipts live in the owner's Midnight Obsidian
  vault under `Initiatives/07 Midnight Passport ACC/SDK milestones/`.

## Done

- **Workflow wiring** (#50) — the `mn-passport-skills` plugin (renamed from
  `mn-skills`), the CI gate, `STATE.md`, and the `.mn-passport-skills/`
  gitignore entry, landed directly on `main` in `c7c9b9b` (2026/07/29) ahead
  of the FS-0.1 tranches; T3 adds the CI backstop on top.
- **FS-0.1 · T1 — workspace root** (#50 ·
  [PR #2](https://github.com/hbulgarini/mn-passport-sdk/pull/2), merged
  2026/07/29) — pnpm workspaces (spec D-9, pnpm@10.33.0 via corepack), the
  strict base `tsconfig`, Prettier, the Node 22 baseline, root scripts, and
  the exact-pinned committed lockfile; the CI gate and cooldown script speak
  pnpm.

- **FS-0.1 · T2 — package skeletons + dependency-boundary lint** (#50 ·
  [PR #3](https://github.com/hbulgarini/mn-passport-sdk/pull/3), merged
  2026/07/29) — the seven `packages/*` skeletons, two-layer boundary
  enforcement over one shared graph module (import-level lint including
  dynamic `import()` and `core` platform-neutrality; manifest + tsconfig
  test with transitive `connect → core` closure), the wiring smoke test,
  and the `.npmrc` posture (`save-exact`, `ignore-scripts`).

- **FS-0.1 · T3 — CI activation** (#50 ·
  [PR #4](https://github.com/hbulgarini/mn-passport-sdk/pull/4), merged
  2026/07/29) — the full gate (lint, format, build, test), the
  `gitignore-backstop` job, Node driven from `.nvmrc`, actions pinned by
  commit SHA. **FS-0.1 complete: issue #50 tranches 1–3 merged.**

- **FS-0.2 · T1 — artefact ingestion + committed binding pin** (#50 ·
  [PR #5](https://github.com/hbulgarini/mn-passport-sdk/pull/5), merged
  2026/07/29) — `build:artefact` compiles the prototype ACC into the
  gitignored artefact directory; the committed manifest pins the binding
  with per-file content hashes (ADR 0004 — compilation is deterministic;
  ADR 0003's contrary finding was a false positive, corrected);
  [passport#116](https://github.com/midnightntwrk/passport/issues/116)
  rewritten as the versioning-ownership decision.
- **FS-0.2 · T1.5 — multi-version binding registry** (#50 ·
  [PR #6](https://github.com/hbulgarini/mn-passport-sdk/pull/6) docs +
  [PR #7](https://github.com/hbulgarini/mn-passport-sdk/pull/7), merged
  2026/07/29 — #7's stacked branch carried both the tooling + data layer
  and the resolution surface, so the planned third PR was subsumed) —
  `acc-versions.generated.json` (every supported version, `current`
  pointer, provenance keys) with its tested TypeScript mirror; per-version
  artefacts; `--pin`/`--current`/`--force` and `--check` (recompile
  determinism for `current`); `resolveBinding`, `SUPPORTED_BINDINGS`,
  `UnsupportedBindingError`, `detectDeployedVersion`, the deep-frozen
  registry (reshaped per PR #7 review), and the platform-neutrality lint
  over every bundle-bound package. Which version an account uses is
  kernel-owned metadata (spec §4.1); the upgrade path stays deferred
  (roadmap §8).

- **FS-0.2 · T2 — typed deploy caller** (#50 ·
  [PR #8](https://github.com/hbulgarini/mn-passport-sdk/pull/8), merged
  2026/07/30) — `buildDeployArgs` shapes
  the ACC constructor call (ordered commitments, version-gated by
  `assertBindingCompatible`, the §8.2 connect-time guard);
  `bindAccModule` gives structural typing over the runtime-loaded
  generated module (`AccModuleShapeError`; shape check only — byte
  integrity is T3's) — the committed package stays dependency-free
  because the generated module needs `@midnight-ntwrk/compact-runtime`,
  added as a root devDependency (0.16.0, exactly the artefact's recorded
  runtime version, past cooldown; first entry in
  `docs/compatibility.md`). The spec's "pure-commitment re-exports"
  became this structural mirror + binder (spec D-9, closing OQ-5). Review
  hardening rode the PR: fully typed witnesses/instance surface, PS
  inferred at the construction site, and the maximise-typing rule
  recorded (code-style skill + CLAUDE.md).

## In progress

- **FS-0.2 · T3 — loader integrity** (#50) — `loadArtefact(source)`:
  platform-neutral (byte source injected — fetch in browsers, fs in
  tests; Web Crypto hashing), verifying every fetched byte against the
  committed registry hashes before returning; `ZkArtifactIntegrityError`
  and `UnknownCircuitError` join the taxonomy with stable codes; prover
  keys load only on explicit request (dev-local proving, FS-0.5). The
  host-runtime execution gap is documented at the loader and stays a
  register item (revisit at `adapter-browser`). Finishes FS-0.2's
  plannable scope — claim-name stays blocked on the C2 gate. Branch
  `feat/fs-0.2-t3-loader`.

## Backlog

- **FS-0.2 · claim-name caller** (#50) — **blocked**: the prototype has no
  name circuit and the C2 name-service artefact does not exist yet (spec
  OQ-4, human decision 2026/07/29). Resumes when the contract team
  publishes C2.
- **FS-0.3–FS-0.8** (`#TBD`) — authored specs in
  [`docs/roadmap/specs/M0-Foundations/`](./docs/roadmap/specs/M0-Foundations/);
  not planned — each still needs its GitHub issue (no issue, no plan).
  **Promoted to the beta critical path** by FS-2.3 (ADR 0005): the onboard
  facade embeds the kernel and seams.
- **FS-2.3 — partner-origin onboarding** (#77) — authored 2026/08/18:
  design in [`docs/onboarding-and-key-authorisation.md`](./docs/onboarding-and-key-authorisation.md),
  spec in
  [`docs/roadmap/specs/M2-Connect/FS-2.3-partner-onboarding.md`](./docs/roadmap/specs/M2-Connect/FS-2.3-partner-onboarding.md),
  ADR 0005; beta scope amended (§2 item 5). Not planned — blocked on
  FS-0.3–0.8 issues/plans; a dedicated issue may replace #77.
- **FS-2.4 — authorising additional keys** (#77) — authored 2026/08/24
  (supersedes the same-day candidate-registry draft: no on-chain candidates
  store, cap, or new circuits): the platform exposes a **signed authoriser
  request** (QR — proof of possession, nonce, expiry, account hint) and
  the PWA approves it with an existing authorised key via the existing
  `add_device` circuit. Design in
  [`docs/onboarding-and-key-authorisation.md`](./docs/onboarding-and-key-authorisation.md) §6, spec in
  [`docs/roadmap/specs/M2-Connect/FS-2.4-authorising-additional-keys.md`](./docs/roadmap/specs/M2-Connect/FS-2.4-authorising-additional-keys.md),
  requirements §3.5 amended. **No contract-team gate.** Not planned — needs
  its own SDK issue.


### 2026-10-29: lifecycle grant-publisher check

Source-v3 (`c068250`) recovered all three Jubjub interrupted mutations, including
survivor rotation, then failed a check that assumed owner-readable grant
bookkeeping. Records are publisher-reader encrypted. The qualification now
checks holdings as owner and opens the actual survivor-published chain seal
with the independent grantee key. No production key format/contract/runtime
change. Failed roots stay failed; new source/image runs remain required.


## Terminal image reconciliation observer — 2026/10/29

Image-v2 passed Jubjub creation, standalone population and survivor enrollment.
Target enrollment then completed normally without the expected observation-loss
marker, so the strict boundary assertion stopped the suite: it remains FAIL. All
22 observed jobs were done. Source/reference end hashes stayed unchanged and the
actual Linux state and owner fixture were protected separately.

The qualification hook watched polling snapshots only. The job client can return
a terminal `done` snapshot directly from reconciliation without polling. The
image-only wrapper now observes both paths, validates the original identity via
the real client, and interrupts before the owner accepts the confirmed outcome.
Transport controls cover confirmed terminal reconciliation without another send,
and unknown outcomes without a manufactured loss marker. Production transport,
service execution and transaction durability are unchanged. Fresh image evidence
is required; this correction does not relabel the failed run. The complete
source-v4 result remains pinned to signed b9a203b and its audited runtime.


The exact native return path that bypassed polling was not isolated. The
qualification wrapper also checks the validated original job after direct
submit completion, before the owner accepts its result. Real HTTP controls
exercise direct completion, terminal reconciliation and unknown outcomes. This
is deterministic owner observation loss after confirmation on either return
path; no production observer semantics or transaction execution are changed.


## Completed local job-backed lifecycle — 2026/10/29

Fresh source-v4/image-v3 passed both arms at signed `b9a203ba03363811588b356b5ae7013895f51e44`
(source) and `7703135cb3b90a4eeb64aca6342fd679ac14a678` (image). Original-ID
enrollment/removal/survivor-rotation recovery, removed-reader refusal, grant/holding
preservation and owner-seed-pinned wallet reconnect passed. Earlier failed roots/unknowns and
old indexer data are retained. No publication/provider/full-Lace acceptance. Details and exact
counts: [review map](docs/review/job-backed-lifecycle/README.md) and
[receipt](docs/review/job-backed-lifecycle/qualification.json).
