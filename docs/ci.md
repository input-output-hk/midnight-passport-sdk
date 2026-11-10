# CI policy and artifact caches

Updated 2026/11/10. Refs #231, #235, #236, #271 and #313.

## Feedback budget

RC8 source runs the synthetic demo browser lane as eight independent
cells: P-256/JubJub × presentation/account-actions/scoped-sessions/owner-safety.
Each owns its browser/Vite server and fresh receipt. The default local command
still runs the entire original flow for both arms in order. Standalone groups use
explicit UI bootstraps rather than assigning authenticated state or grant authority.
RC8 retained97P-256 and95JubJub cases. The current source catalog has104P-256
and102JubJub cases, with stable historical IDs/names and explicit new cases.

The stable required **Lint, format, build, and test** aggregate waits for both the
matrix and **Complete browser journey inventory**. A failed, cancelled or skipped
cell refuses. The inventory job downloads exactly eight current-run receipts and
checks their source, runtime/catalog hashes, case order/union, purpose observations,
complete setup/body/cleanup and monotonic timing accounting. Credential-purpose
expectations are shared with the browser observer and specific to each cell.
The isolated JubJub scoped-session bootstrap reuses its reviewed creation keys
and therefore has no `verify-created` access. The P-256 cell and other account/owner
flows retain their verification expectations. Missing or unexpected purposes refuse. A case count alone
cannot satisfy the gate. Real worker/IndexedDB contracts run once in the P-256
presentation cell and remain required through that cell's outcome.

Cells retain a unique `journey-<arm>-<group>` artifact for seven days, with missing
files treated as errors. Upload v7.0.2 and download v8.0.2 are pinned to reviewed
immutable commits; the official releases date2026-10-07, past the seven-day
cooldown. These actions useNode24 on the existing hostedUbuntu runners. Download
uses the current run, preserves per-artifact directories and sets
`digest-mismatch: error`. Artifact digest checks do not replace semantic receipt
validation or the original signed-source/input audits. No token, cross-run download,
new key cache, artifact execution or release publication is added.

Measure the30–45second warm target after an authorized push. Local group/body
intervals exclude dependency setup/build and cannot prove whole-job latency.
No proof/key generation or assertion/wait removal is used to meet the target.

The target is **30–45 seconds per warm required PR job**, from job start through
post steps. Record queue time, total PR critical path, cache restore/save and cold
dependency downloads separately. This is a performance target, not a 45-second
timeout or permission to omit a failing check. Remote timings for these changes
must be measured after an authorised push; local timing is not hosted-runner evidence.

The previous PR core job took 44 seconds, with 38 seconds in its combined install
and check step ([run 39258286209](https://github.com/input-output-hk/midnight-passport-sdk/actions/runs/39258286209)).
The key-image job took 47 seconds. The initial changes preserve coverage, add
dependency and Docker layer caching, separate timed steps and cancel obsolete PR
runs. Image checks no longer trigger for Markdown-only changes. Docker checks
also cover all workspace packages and root build inputs copied by their Dockerfiles.

| Lane | Trigger | Evidence | Budget |
| --- | --- | --- | --- |
| Required PR checks | Every PR; manual dispatch | Boundary/circuit lint, formatting, fresh build, all package/app/key-server tests, application types, register exclusion and dependency cooldown | 30–45 s warm per job; 5 min core safety timeout |
| Image checks | Relevant code, build input or workflow changes | Build Linux image, startup refusal/non-root smoke checks | Target 30–45 s warm; cache and cold timing reported separately |
| Key cache qualification | Relevant pushes to prototype; manual dispatch on prototype | Regenerated or restored keys checked against pinned SHA-256 hashes | Independent, up to 20 min; never required on every PR |
| Chain/browser qualification | First-slice harness, currently explicit local commands | Real proof, submission, state/fund movement, interruption and browser semantics | Minutes, resource-qualified; #231 tracks automation |
| Release | Existing signed-tag workflows | Packed installs, reproducibility, signatures, attestations, images and published docs | Full release budget; no fast-lane exemption |

No job converts a failure or an unconfigured/absent proof scenario into successful
qualification. The fast lane does not prove recovery safety or Lace compatibility.
Full key generation and P-256 transactions cannot meet a 45-second budget: all 52
prover keys total 12,175,495,280 bytes and a P-256 proof alone can take tens of seconds.
Keep complete local checks before every commit as specified in `AGENTS.md`.

Source-preview #236/#313 tooling adds deterministic release transport/resource tests
to the existing root `node --test` inventory. The explicit `release:accept` and
`qualify:mounted` commands are opt-in operator/release lanes; no authenticated
registry download, two-build reproduction, live Pages or mounted proof work is
added to required PR jobs. See the [review map](review/release-acceptance/README.md)
and [operator guide](../docs-site/operations/release-acceptance.md). Their synthetic
tests do not establish actual registry/image/native acceptance or hosted timing.

## Cache inventory

### Dependency downloads

`pr-checks.yml` caches only the pnpm10 `files`/`index` downloads and v2 catalog
under `.cache/pnpm`, keyed by format(`pnpm-v2`), OS/architecture, Node
pin, pnpm version/root manifest, workspace policy, registry config and lockfile.
An OS/architecture prefix can reuse older downloads. Every run still installs
with the frozen lockfile and verifies dependency integrity. `node_modules`,
TypeScript incremental state and `dist` are rebuilt; they do not get to suppress
checks or create stale outputs. Workspace packages are not published from CI caches.

`warm-dependencies.yml` populates that same download key on trusted prototype
pushes affecting cache inputs, or an explicit prototype dispatch. A PR's merge-ref
cache cannot warm another PR; PRs may restore their base branch's cache
([GitHub cache access rules](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)).
The warmer isolates npm configuration from user/global credentials, rejects
private SDK scopes and non-public registry/tarball origins, disables lifecycle
scripts, and performs a fresh frozen install with store-integrity verification.
It independently hashes every pnpm10 content-addressed file with SHA-512 before
restored bytes are used and before saving. Shared PR preparation performs the same
checks before and after installation. This detects content corruption even when
pnpm's installation fast path accepts it. Layout/CAS admission alone does not
prove that an index came from a lockfile tarball; trusted cache scope and fresh
frozen package installation remain required. The v2 catalog seals index metadata
and all cached file bytes; restores must match it before installation. Missing
or legacy catalogs refuse, and v1 keys are not restored. This is a substitution
detector within trusted workflow cache scope, not a publisher signature or defense
against someone authorized to replace both cache and catalog. Unsafe cache bytes fail the job;
they are never silently accepted as a performance optimization.
Project symlinks (`v10/projects`), workspace outputs, private registry archives,
secrets and prover keys are excluded from the archived paths.
PR builds still install and build freshly; a cache hit never skips assertions.

### Bounded dependency metadata

The seven-day gate resolves both committed revisions and all tracked supported
lockfiles, including nested workspaces. It deduplicates package versions and
requests public npm metadata with four concurrent requests, at most two attempts,
an eight-second request deadline, a thirty-second overall deadline and bounded
responses. Unsupported lock formats, failed fetches, redirects, missing versions
or invalid/future publish dates refuse. A deliberate security override may
acknowledge a known recent version; it cannot replace missing age evidence.
Metadata is not cached. The gate never reads registry credentials or executes npm.

### Measure before changing scheduling

Use Nix and a new private evidence directory to collect existing completed PR
runs without dispatching, rerunning or changing any workflow:

```sh
nix develop -c pnpm ci:timing --runs "$RUN_IDS_COMMA_SEPARATED" \
  --output "$NEW_PRIVATE_TIMING_ROOT"
```

The collector records run/attempt/head/workflow hash and all twenty jobs, including
eight browser cells and four package shards. Job wall time, step time, preparation,
registration offsets and unobserved queue/allocation components remain distinct.
The API head is labelled separately from the actual merge checkout. A workflow
hash read from the PR head does not establish the executed workflow/action bytes.
The collector therefore never establishes repeated warm-target acceptance from
API/log metadata alone; actual executed-source binding remains required.
Cache state requires the pinned action's own restore output: exact hit, prefix
fallback, miss and unknown are separate. Missing logs cannot become warm evidence.
Raw job logs remain private; do not mirror them into handover material.

Package jobs retain a second reporter artifact beside normal TAP. It records all
test-file hashes, process-inclusive timings and counts without collecting test
stdout, fixture data or individual test names. All original built-in Node shards
and their assertions remain unchanged. Download a single run attempt's four
matching artifacts and obtain an **advisory** exhaustive partition:

```sh
nix develop -c pnpm ci:plan-shards --shards 4 \
  "$PROFILE_1" "$PROFILE_2" "$PROFILE_3" "$PROFILE_4"
```

Admission rejects stale hashes, differing source/runtime/workflow/attempt,
overlapping or omitted files, inconsistent counts and unsuccessful samples.
Observed process-load sums are not predictions of hosted whole-job duration.
The command changes no CI scheduling.

On 2026-11-10 the read-only baseline for merged PR319
([run42885501844](https://github.com/input-output-hk/midnight-passport-sdk/actions/runs/42885501844))
showed cache misses in all fifteen substantive jobs. Package jobs took48–58s,
browser jobs51–76s. Two earlier sampled runs also had fifteen misses each, and
the trusted prototype had no matching dependency-download cache. These are
historical cold measurements, not acceptance of this local source change.
The30–45s target remains open: require at least three successful matching-source,
matching-workflow runs with exact cache hits and every required job within45s.
Do not infer a pass from body-only timings, mixed heads or an unexecuted warmer.

### Docker build layers

Service and funding PR image checks use BuildKit's GitHub cache backend, with
separate scopes and `mode=min` to bound storage. They load a local check image and
run the existing startup smoke tests plus the shared actual-image filesystem policy; they do not push an image. PR cache scope
is separate from trusted base-branch scope. Release image publication keeps its
existing independent build and signed-tag policy.

### Passport prover/verifier keys

`qualify-key-cache.yml` warms **`jubjub-owner-v1`**, ten circuits and 529,293,067
uncompressed bytes of prover and verifier files. This is a bounded integrity
profile, not a declaration that every consumer circuit or all P-256 flows are
covered. Small ZKIR, verifier inputs, generated modules and manifests already
travel in the pinned contract package and Git checkout.

`scripts/ci-key-cache.mjs` builds an exact cache identity from:

- Cache format, OS/architecture, binding, profile and sorted circuit selection.
- Independently pinned key/compiler manifest, ZKIR bundle bytes and compiler provenance.
- `flake.lock`, flake configuration, Compact recipe, restore script, profile and cache logic.

There is **no prefix fallback** for key artifacts. A hit must have the exact file
set, sizes and SHA-256 hashes; symlinks, incomplete entries, extras and corrupt
keys fail. A miss invokes the existing pinned Compact 0.35.0 restoration CLI,
which verifies both regenerated provers and verifiers before the cache is saved.
The workflow then independently verifies every selected file. `cache-hit=true`
is never an integrity assertion. Cache entries hold only public reproducible
keys, not encrypted user records, wallet seeds, credentials or witnesses.

Run locally inside the Nix shell:

```sh
node scripts/ci-key-cache.mjs plan
# Use the directory and circuits printed by plan:
node packages/contract/bin/restore-acc-keys.mjs \
  --binding acc-s3r1.1 --output <directory> --circuits <comma-separated-circuits>
node scripts/ci-key-cache.mjs verify
```

The planner caps a profile at 1 GiB. It deliberately refuses `all`; caching all
52 circuits would exceed this repository's current **10 GB** cache setting
(read via the API on 2026/10/20), even before pnpm, Docker and CodeQL entries.
GitHub allows administrators to increase the limit, with billing above the free
allowance; no setting or paid capacity has been changed. Future full-proof cache
shards need measured selection, size, restore latency and eviction costs before
adoption. See [GitHub's cache reference](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching).

## Trust and invalidation

Caches can be read by PR authors, including fork PRs; never put secrets or
non-public packages into these public-repository caches. Low-trust PR cache scope
must not become a source of release trust. The key warmer only executes trusted
prototype pushes or a manual run on that branch. It uses no personal token and
does not publish packages/images. No `pull_request_target` execution is added.

The workflow is available after merge to the prototype. There is no scheduled
trigger: GitHub schedules require the workflow on the default branch, while this
fork's development target is `passport-acc-prototype`. Use relevant pushes or an
explicit manual warm-up. An evicted entry safely regenerates; an immutable corrupt
entry must be investigated and deleted by an operator before rerunning, rather
than silently trusted or overwritten.

## First-slice measurement and remaining work

After a permitted push, compare at least three warm runs with cold/cache-miss
runs. Report job and critical-path durations, compressed restore bytes/time,
cache occupancy and slowest steps. Do not remove meaningful tests to meet the
target. If caches slow down a cheap job, remove that cache after measuring.

#231 adds proof/localnet/browser harness receipts and eligible artifact reuse;
#235 qualifies profiles and artifact consumers; #236 joins registry, image and
documentation acceptance. Nix binary-store caching and TypeScript output caches
are deferred until measurements justify their storage and invalidation overhead.
Public signed release receipts are durable evidence; GitHub cache is disposable
acceleration and must not be the only copy of a release artifact.

## Local stability correction

A repeated local gate exposed a failed `fetch` in the legacy artifact HTTP tests
that left its listener open, so the test process did not exit. Those fixtures now
bind and connect to explicit IPv4 loopback and register connection teardown with
`TestContext.after` before assertions. Cleanup runs on failure as well as success.
This changes test resource ownership, not the service's production network binding.

## Stability harness foundation

`pnpm qualify` now separates source, generated-contract simulator, unit/port,
virtual-browser, proof/localnet, packed/published-consumer and manual-provider tiers.
Its negative/ledger tests run through the existing PR test glob. Expensive real
flows remain opt-in; unavailable/missing/skipped cases cannot qualify a suite.
See [the guide](site/qualification.md) and [review map](review/stability-foundation/README.md).

### Mutation interruption qualification (#230 / #239)

Keep the complete `scripts/qualification/mutation-matrix.mjs` in the explicit slow
lane. It spawns a fresh process per crash/resume boundary in both owner arms and
executes the pinned generated ACC without proofs/funds. Source/runtime fingerprints
must remain fixed. The default gate keeps representative restart, cancellation,
unknown-outcome and no-replacement tests plus the fast grant/storage negatives.
Hosted scheduling measurements follow below. No workflow was manually dispatched.
Do not cache the protected mutation journal or fixture
world files; only redacted hashes/case counters belong in acceptance artifacts.

## Hosted measurements — 2026/10/23

The first stack's core jobs passed in **65 s** ([#248 run](https://github.com/input-output-hk/midnight-passport-sdk/actions/runs/40026604779))
and **81 s** ([#249 run](https://github.com/input-output-hk/midnight-passport-sdk/actions/runs/40026626812)).
Install took 3 s; build 8–9 s; package/application tests 25/43 s; application types 7–8 s.
All other required core jobs took 4–6 s. The initial serial lane exceeded the warm target. The revised scheduling below
keeps coverage while separating independent checks. Actual proof/fault matrices
remain opt-in. No workflow was manually dispatched for these measurements.

### Hosted gate scheduling — 2026/10/24

The first foundation core jobs took 65–81 seconds. The revised workflow splits
lint/format, the complete build/type checks, application/key-service tests and four
disjoint Node package-test shards. Every shard requires at least four matching files
before execution. Fresh outputs are built in each runner; only the lockfile-keyed
pnpm download store is cached. The unchanged required aggregate refuses failed,
cancelled or skipped dependencies. All external actions remain SHA-pinned.

At source `06dbdc6`, the top-stack [hosted run](https://github.com/input-output-hk/midnight-passport-sdk/actions/runs/40036195974)
passed: lint 24 s, full build/types 29 s, apps 38 s, package shards 20–45 s,
aggregate 3 s. This workflow is carried into the foundation PR so dependent PRs
also use the bounded lanes. These are observed runs, not a universal cold-cache
timing guarantee; proof/outage matrices remain opt-in.


## Candidate deterministic demo browser lane — 2026-11-05

PR checks now include a separate `demo_browser` job and require its success in the
existing aggregate gate. It runs actual runner Chrome, fresh package outputs and
26 grouped scenarios across both owner-arm selections using synthetic connector,
chain and wallet drivers. The real UI, mock credential API, consent hooks, handoff
parsing and public capability planner execute. Each authenticated action is also
declined before its successful attempt. No key generation, native proof, browser
download, credential/provider access or Docker stack is needed. Job summaries retain
the explicit scope/fingerprint receipt; no private mock state is exported.

It reuses the frozen dependency cache and builds outputs freshly. The target stays
30–45 seconds per warm job, subject to actual hosted measurement after push. Slow
native/provider lanes remain separate. `pnpm test:coverage` is an opt-in Node/V8
package-only measurement, not added to fast required jobs or an arbitrary threshold.

### Workflow expression validation

For workflow changes, validate schema/expressions locally with `actionlint` from
the repository-pinned nixpkgs, in addition to the Node gate:

```sh
nix shell --inputs-from . nixpkgs#actionlint \
  -c actionlint -shellcheck= -pyflakes=
```

This command disables optional shell/Python linters; it still validates workflow
structure and expression contexts. An initial RC7 PR attempt put `runner.temp` in
job-level `env`, where it is unavailable. GitHub rejected the workflow before any
core job ran. The correction resolves the receipt path in both runner steps.
The failed run is retained; a green list containing only image jobs is not a
passing full gate. Require every named core component and the relevant image
checks at the current head. The key-image path filter is unchanged: no key/contract
inputs changed in this UI tranche, so its absence is expected, not a waived test.

### RC7 measured PR timing

Replacement run42052754580 at signed bbf883d passed every required component.
Warm core jobs took6–45seconds except the synthetic browser lane at65seconds
(47seconds of actual UI execution plus preparation/cleanup). Relevant image checks
took26seconds(service) and41seconds(funding). The30–45second goal is therefore
**not met by the browser job**. Keep this visible in #271; do not hide the excess,
weaken ceremony assertions or put native proof/key generation into fast PR CI.
Signed-tag release/publisher reproducibility and image restoration remain slower
release gates, outside the fast development target.

## Local-source release quality gate (2026-11-07)

Required lint now includes TypeScript AST budgets; compiler checks also reject
unused locals and parameters. Existing measured debt is explicit in
`scripts/code-quality-budgets.json`; lint never regenerates it. `quality:report`
locates large/complex functions. These checks require no proving artifacts.

`test:coverage` uses pinned c8, source maps and an inventory of all executable
authored sources in the nine public packages, including unimported files. It
requires 80% lines/functions/branches globally and per package, refuses missing
source evidence, and records exclusions. Release verification runs this gate
before packing. It is intentionally outside the short required PR critical path.

The P-256 browser job additionally runs `test:background` once (the worker protocol
is independent of the owner arm): actual Chromium workers and IndexedDB, synthetic
wallet work/balances, plus actual wallet SDK import in a worker. Its receipt is
included in the job summary. It does not contact a user's demo or start Docker.
Measure warm hosted timing after an authorized push; local timing is not proof of
the 30–45-second hosted target. The full browser journeys still run both arms.

### Documentation type contracts — local source follow-up

Required `lint` also runs `scripts/docs/snippets.mjs` (`pnpm test:docs` alone). It
strict-checks the exact TypeScript fences and example modules against actual public
source exports in four ambient targets. The inventory rejects unregistered pages,
fences and modules rather than silently skipping new examples. It executes no
example, starts no host and requires no Docker, keys or generated build output.
Declaration-only pinned binding files remain checked source inputs.

Keep code snippets complete and mark their release/runtime track beside the code.
A source compile does not establish an installed RC's behavior, provider support
or a successful transaction. Preserve the separate library and demo guide entry
paths; do not import the demo's policy or UI into reusable API documentation.
Measure the extra warm hosted time after an authorized push; local timing alone
does not establish the required 30–45-second CI target. No push occurs tonight.


### Runtime-image content policy

Both service/funding smoke scripts run `scripts/check-runtime-image.mjs` inside
the built image as the configured non-root user, without network or writable root.
Known private review paths and app/package `test`, `tests`, and `qualification`
roots refuse. Their context exclusions precede either Dockerfile's COPY; the
inspection covers the final filesystem rather than merely matching Dockerfile
text. This is a bounded artifact-content policy, not a general secret scanner or
functional native-proof/readiness test. Image publication still needs its existing
pinned-export and actual runtime qualification. Local receipts identify the exact
image ID; registry digests are established only by publication.
