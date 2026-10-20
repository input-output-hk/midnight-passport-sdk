# CI policy and artifact caches

Updated 2026/10/20. Refs #231, #235 and #236.

## Feedback budget

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

## Cache inventory

### Dependency downloads

`pr-checks.yml` caches only `.cache/pnpm`, keyed by format, OS/architecture, Node
pin, pnpm version/root manifest, workspace policy, registry config and lockfile.
An OS/architecture prefix can reuse older downloads. Every run still installs
with the frozen lockfile and verifies dependency integrity. `node_modules`,
TypeScript incremental state and `dist` are rebuilt; they do not get to suppress
checks or create stale outputs. Workspace packages are not published from CI caches.

### Docker build layers

Service and funding PR image checks use BuildKit's GitHub cache backend, with
separate scopes and `mode=min` to bound storage. They load a local check image and
run the existing startup smoke tests; they do not push an image. PR cache scope
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
No workflow was dispatched, and hosted 30–45-second timings still need measurement
after an authorised push. Do not cache the protected mutation journal or fixture
world files; only redacted hashes/case counters belong in acceptance artifacts.
