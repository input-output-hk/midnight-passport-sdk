# Verify a release

**Source preview after RC9.** These repository tools help maintainers verify an
existing release. They are not installed SDK APIs, demo features or publishing
commands. Applications should start with [package integration](/getting-started/first-integration).

The checker keeps five identities separate: the signed SDK source, private
publisher source, documentation deployment, acceptance runner and installed
dependency graph. A newer runner can check an older release without relabelling
that release's bytes. Local edits do not publish packages, images or Pages.

## Choose the evidence you need

| Command lane | Checks | Boundary |
| --- | --- | --- |
| `registry` | Two independent builds of signed source; all nine actual private registry archives, `next`, SRI/SHA, source/publisher attestations; fresh installation, runtime identity, types, software crypto, synthetic interruptions, browser build and one-circuit restore | Requires authorized private-package access; no native or provider claim |
| `images` | Anonymous manifest access and immutable pulls; source/version aliases, platform/non-root metadata, backend refusal tests; exact verifier catalog and hashes, prover/range/CORS and one-circuit regeneration | Runtime image acceptance; no wallet movement |
| `pages` | Successful pinned build/deployment, exact uploaded artifact hash, anonymous served page/asset equality and active installation/image commands | Documentation acceptance; not functionality |
| `all` | The three checks above, with separate receipts | Mounted/native acceptance remains separate |
| Mounted lane | Actual production service/funding entrypoints, fresh standalone chain/state, create/activate/read/reopen, NIGHT deposit/replay/repeated deposit and unavailable-token refusal before submission | Source SDK client and synthetic JubJub credentials; not registry-installed native, job-backed image faults, real providers or full Lace |

## Prepare an acceptance plan

Copy `scripts/release/plan.example.json` to your private operator workspace and
replace the paths with independently verified inputs. The example records RC9;
it is not a moving release pointer. Verify release signatures before selecting
source/archive hashes, GPG fingerprints, image digests and the Pages artifact hash.
Keep the five identity axes explicit. Tokens never belong in the plan.

Use the repository's Nix shell, a clean signed runner commit and a new private
output directory outside source, reference and bundle trees. Supply the plan's
SHA-256 from your review record:

```sh
PASSPORT_RELEASE_ACCEPTANCE=1 nix develop -c pnpm release:accept \
  --config "$ACCEPTANCE_PLAN" --sha256 "$ACCEPTANCE_PLAN_SHA256" \
  --lane all --output "$NEW_ACCEPTANCE_ROOT"
```

The registry lane requires `GITHUB_TOKEN` or `GH_TOKEN` with package-read and
attestation access. Installation uses temporary user npm configuration, disables
install hooks, retains the seven-day external dependency cooldown and exempts
only the nine exact SDK versions. Temporary auth is removed in `finally`;
an abrupt machine/process kill still requires operator inspection. Later probes
receive a restricted environment without those credentials or Node preload hooks.

Every lane also verifies the downloaded signed publication/Pages manifests, their
checksums, both release records, remote annotated tag objects and the exact successful
publication workflows. The active Pages run must be the documentation build/deploy
workflow. Canonical library/API/demo/release routes are mandatory; a version mentioned
only in historical prose cannot satisfy current installation instructions.

Only the exact authenticated registry origin receives the bearer token. An
artifact's GitHub-signed CDN redirect uses a separate credential-free request;
other redirects, ambiguous signature parameters and oversized bodies refuse.
Registry compressed bytes retain their own integrity and provenance checks.
Decompressed source equality allows content comparison despite gzip differences;
the receipt records compressed and OS-header-byte differences separately without
attributing every compressed difference to its header. Both
independent builds on one platform must still match **exact archive hashes**.

The one-circuit key-image restore may download Midnight's public SRS through its
verified compiler. That helper alone uses bridge networking; backend refusal and
content probes remain offline. The regenerated public key hashes must still equal
the independently pinned manifest. No wallet or registry credential enters this helper.

The checker writes private receipts and retains failed attempts. Sign and verify
the reviewed receipt before using it as release evidence:

```sh
nix develop -c gpg --local-user "$RECEIPT_SIGNER" --armor --detach-sign \
  "$NEW_ACCEPTANCE_ROOT/receipt.json"
nix develop -c gpg --verify "$NEW_ACCEPTANCE_ROOT/receipt.json.asc" \
  "$NEW_ACCEPTANCE_ROOT/receipt.json"
```

Publication remains a separate authorized workflow with GPG/DCO source/tag
checks. Never upload the private evidence directory or mirror private npm archives
as public release assets.

## Mounted standalone qualification

Use `scripts/release/mounted-plan.example.json` as the schema reference. Fill the
current signed **runner/client** commit, exact production image digests, three
cached chain image IDs, pinned Compact 0.35.0 contract export and independently
prepared Linux dependency volume/lock/tree hashes. Zero/example pins must be
replaced. Do not mount host macOS dependencies as Linux dependencies.

The lane requires 15 GiB free disk, at least 24 GiB Docker memory, verified cached
keys and unoccupied dedicated ports. It uses a local Unix Docker socket, pins the
daemon identity and never pulls or regenerates the full key set. Its stable native
lease is shared with other native qualification lanes. A busy lease or port
refuses; it is not permission to stop another stack or delete a lease.

```sh
PASSPORT_MOUNTED_NATIVE=1 PASSPORT_RC_LOCALNET=1 MN_NETWORK_ID=undeployed \
  nix develop -c pnpm qualify:mounted \
  --config "$MOUNTED_PLAN" --sha256 "$MOUNTED_PLAN_SHA256" \
  --output "$NEW_MOUNTED_ROOT"
```

The runner creates a fresh project, chain volumes and service/config state. It
records allocation/start intent before Docker dispatch, then captures exact IDs.
Unknown allocation/start replies block further creation. Initialization and
fingerprint helpers are owned compute too. The sponsor must be observed stopped
before the funding wallet starts. Application mappings preserve the configured
port; Host validation remains enabled and a mismatched external port returns 421
before the request reaches application handlers.

Source, compiled outputs, physical dependencies/reference, Linux dependency bytes,
binding and streamed key hashes are checked across the mounted interval. SIGINT
requests bounded cleanup; cancellation cannot undo an account transaction or deposit.
PASS requires declared functional assertions, unchanged inputs, freshly verified
quiescence and exact acquired-lease release. Drift or unresolved cleanup retains the
lease. Containers, chain/key/state volumes, original IDs, reservations and failed
fixtures remain available for reconciliation.

Creation/funding intent and synthetic identity are retained privately before
dispatch. This is an interruption-safe **infrastructure** lane, not an automatic
account/job recovery API. An interrupted creation can remain unknown. There is no
automatic rerun, new-ID retry, journal clearing or state reset.

Retain the complete ledger transaction identifier, including its tag, for deposit
reconciliation. Parent hard-kill recovery remains a manual operator task: a retained
lease is not proof of subprocess closure. Durable child process identity/closure
records are a follow-up; this lane does not claim tested parent-SIGKILL recovery.

## CI and integration boundaries

Deterministic transport, process, ownership and coordinator tests run in the normal
unit gate. Authenticated downloads, two builds, Docker/native work and deployed
Pages checks are explicit opt-in release work; they do not enter every fast PR job.
The hosted 30–45-second warm target still needs independent measurement.

These tools do not change SDK authorization policy, exact-value shielded withdrawal
guards, total-loss recovery or Lace compatibility. Keep library contracts in
[Guides](/guides/) and the reference app's orchestration in [Demo](/demo/).
