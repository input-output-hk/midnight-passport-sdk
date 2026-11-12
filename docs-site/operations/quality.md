# Testing, qualification, and releases

The repository checks public TypeScript documentation examples against package exports. The first browser integration is compiled in the browser target. The SDK's required lint, format, build, unit, app, and type checks are separate from proof generation or a funded localnet. The VitePress build checks page generation and internal links under the GitHub Pages base path; browser review checks navigation, search, responsive layout, and rendered diagrams.

**Evidence has scope.** A source typecheck, fake-chain test, synthetic browser run, native proof, real passkey provider, installed package, and hosted Lace consumer each establish different behavior. A source-only change is not a published RC9 capability. The [RC9 release notes](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/site/release-notes-rc9.md) and [signed publication receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc9/rc9-publication-receipt.json) are the release-specific sources. The [qualification guide at that tag](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc9/docs/site/qualification.md) names provider and native limits.

To change the SDK, follow [contribution guidance](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/CONTRIBUTING.md) and the repository's signed commit/DCO policy. To publish packages, images, or Pages, use the repository's release procedures; a local documentation build publishes nothing. [History and migration](/operations/archive) keeps older release notes outside the learning path.

## Package quality contract

The reusable packages expose framework-neutral contracts; browser credential access,
DOM rendering, wallet workers and Node services belong in their adapters or host.
Account authority, viewing/reader capability and a separate HD wallet are distinct.
Validate untrusted identifiers, amounts, configuration and remote responses before
credential, wallet or proof work. Unknown mutation results retain their original IDs.

The required PR gate runs lint, formatting, build, package/application tests and
application type checks. AST checks enforce public package boundaries and reviewed
file/function/complexity budgets. New modules use the defaults; raising a legacy
ceiling is not a refactoring strategy. The all-file package coverage gate requires
**80% lines, functions and branches globally and in each of the nine packages**.
Generated artifacts, type-only modules and test helpers have explicit exclusions;
app, native and provider coverage are separate measurements.

The P-256 and JubJub account entry points compose private operation modules. The
reference demo separates controllers from per-instance presentation state; a
partner imports public SDK exports, not those DOM controllers. The native reference
bridge uses actual v9 types, checked module capabilities and validated retained
contexts. Resume preserves the original key, plan bytes and waves rather than
creating a replacement authority. Primitive platform-global casts and other
remaining measured debt stay explicit.

## Hosted CI timing

Functional CI and its latency budget are separate checks. PR320 passed 22 checks,
and three repeated complete warm attempts observed exact dependency-cache hits in
all 45 substantive job executions. Package jobs still took 43–83 seconds and browser jobs
48–92 seconds. The current warm target is 90 seconds per required job. Reports
still list jobs over the former 45-second target. Fresh builds, integrity checks,
all test assertions and both credential arms remain required.

The first source follow-up splits one slow 14-case publication test into three
semantic files, preserving each case and its fresh fixture. Its performance benefit
needs a new hosted measurement. See the [CI policy and measured runs](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/ci.md#pr320-hosted-cache-validation)
for sample identities, whole-job costs and evidence limits. The published package
API and RC9 release claims are unchanged.

## Choose the right evidence

| Check | Establishes | Does not establish |
| --- | --- | --- |
| Unit/port and type tests | Validation, byte ownership, consent/state transitions and target contracts | A working provider or chain |
| Both-arm synthetic browser jobs | UI flows, cancellation, stale completions, original receipts and navigation | Real passkey sheets or restored credentials |
| Browser worker tests | MessageChannel/worker/IndexedDB wiring with synthetic state | Live wallet synchronization or proof performance |
| Installed quality and crypto | Exact archive bytes, strict Node/DOM/Worker consumers, runtime identity and software/generated-contract cases | Registry provenance, native proof or full Lace compatibility |
| Native and mounted-image qualification | The declared proof/node/functionality on its recorded source, mounts and image | Every circuit, provider, network or recovery promise |
| Publication verification | Actual registry bytes/attestations/access, image manifests and deployed docs | A broader product capability than the release declares |

The opt-in release workflow prepares a fresh external consumer and composes the
existing installed-quality and software-crypto runners. Manifest/lock pins,
physical runtime identity and before/after input hashes are checked; an unknown
feature-probe file still refuses. Failed roots and receipts are retained. These
checks are outside the required fast PR jobs. An actual authenticated registry
installation and source/publisher attestation checks remain necessary after publication.

The source-preview [release acceptance tools](/operations/release-acceptance) compose
these checks with actual registry/image/Pages verification. Their mounted lane uses
a separately leased fresh standalone stack. Deterministic transport and interruption
tests run in the normal unit gate; the live lanes remain opt-in release work.

See the [RC9 release notes](/operations/rc9-preview) for the current increment and
its signed artifact evidence. The [exact source review map](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/review/quality-debt-2026-11-10.md)
explains the decomposition; it is source evidence, not a replacement release receipt.

The partner-handover content policy includes the current VitePress guide sources
alongside the legacy examples, while excluding build caches, dependencies and
contributor/tooling material. Rendered output and package archives are checked
separately. This bounded content check is not a general secret audit or a claim
that historical repository material has been removed.

## Hosted network preflight

Before qualifying wallet-to-ACC funding on a hosted network, obtain the expected
genesis hash and runtime spec name and version from the network operator through a
trusted channel. Use those pins with the node and indexer URLs for the specific
environment. Set the environment variables below and run
`nix develop -c pnpm qualify hosted-network` from a built SDK checkout.

- `MN_NETWORK_ID` is the hosted network label used in your SDK configuration.
- `MN_EXPECTED_GENESIS_HASH` takes 64 lowercase hexadecimal characters without `0x`.
- `MN_EXPECTED_RUNTIME_SPEC_NAME` and `MN_EXPECTED_RUNTIME_SPEC_VERSION` identify
  the expected runtime spec and its decimal version.
- `MN_NODE_URL` and `MN_INDEXER_URL` point to the HTTPS JSON-RPC and GraphQL
  endpoints. Supply URLs without embedded credentials or query strings.

The command exits successfully when the node matches the genesis pin, the runtime
matches at a canonical finalized block, and the indexer returns that same block
with a timestamp within two minutes of the local clock. An unavailable or stale
observation exits nonzero. The result contains the block identity and lag and
omits endpoint URLs. The command reads chain metadata and starts no wallet,
prover or service.

This is the first check for [hosted funding qualification](https://github.com/input-output-hk/midnight-passport-sdk/issues/243).
Value qualification still requires an operator-owned funded wallet, a verified
ACC binding and asset policy, durable transactional reservations, and attributable
proof-backed deposit and withdrawal receipts. Test concurrent senders, fee handling,
indexer lag, partial failures and replay on the chosen network before enabling it.
