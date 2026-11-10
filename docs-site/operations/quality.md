# Testing, qualification, and releases

The repository checks public TypeScript documentation examples against package exports. The first browser integration is compiled in the browser target. The SDK's required lint, format, build, unit, app, and type checks are separate from proof generation or a funded localnet. The VitePress build checks page generation and internal links under the GitHub Pages base path; browser review checks navigation, search, responsive layout, and rendered diagrams.

**Evidence has scope.** A source typecheck, fake-chain test, synthetic browser run, native proof, real passkey provider, installed package, and hosted Lace consumer each establish different behavior. A source-only change is not a published RC8 capability. The [RC8 release notes](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc8/docs/site/release-notes-rc8.md) and [signed publication receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc8/rc8-publication-receipt.json) are the release-specific sources. The [qualification guide at that tag](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc8/docs/site/qualification.md) names provider and native limits.

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

See the [RC9 candidate scope](/operations/rc9-preview) for the next increment and
its unfinished release gates. The [exact source review map](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/review/quality-debt-2026-11-10.md)
explains the decomposition; it is source evidence, not a replacement release receipt.

The partner-handover content policy includes the current VitePress guide sources
alongside the legacy examples, while excluding build caches, dependencies and
contributor/tooling material. Rendered output and package archives are checked
separately. This bounded content check is not a general secret audit or a claim
that historical repository material has been removed.
