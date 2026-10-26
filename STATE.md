## 2026/10/26 — host preparation and evidence review correction

Call preparation now retries only its original durable input under a fresh revision
fence; stale preparers cannot dispatch. Deployment constructor loss, expired bytes,
pre-host proof failure, key-origin exceptions and concurrent ledger/deposit changes
remain explicitly unresolved. Do not infer no send or replace unknown output.
Historical 90-transaction evidence predates later corrections and does not qualify
this head. New call-preparation/fence regressions are fast source tests. No binding,
exact-value guard, publication or broad #230 closure changes.

# STATE — Midnight Passport SDK

> The committed record of SDK development, maintained by
> `mn-passport-skills:spec-driver` per [`docs/development-workflow.md`](./docs/development-workflow.md) §3.
> Every entry carries its GitHub issue
> ([midnightntwrk/passport](https://github.com/midnightntwrk/passport/issues)).
> Last updated: 2026/10/23. Historical entries below retain their original issue namespaces.

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
