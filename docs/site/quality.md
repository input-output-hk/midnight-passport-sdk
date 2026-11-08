---
layout: default
title: Package quality and test strategy
permalink: /quality/
---

> **Source preview after RC7:** the APIs and gates on this page are local release work.
> They are not available in the published RC7 packages; use the matching source or a later verified release.

## What the release must establish

The product is nine framework-neutral packages with explicit platform adapters.
The demo shows how to combine them. An SDK host controls UI, credential custody,
consent, wallet selection and deployment wiring. See the [package purposes](../packages/)
and [local release backlog](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/review/sdk-quality/README.md).

| Quality attribute | Standard | Verification |
| --- | --- | --- |
| Correctness | Both signature arms retain circuit ordering, exact-value shielded spends and live-state checks | Unit/use-case tests plus native qualification where claimed |
| Testability | Ports accept deterministic clocks, transport/storage fakes and owned ephemeral resources | Positive, negative, boundary, race and restart cases |
| Coverage | At least 80% lines, functions and branches, globally **and for each public package** | `pnpm test:coverage`, inventory and raw counters |
| Type safety | Strict TypeScript, unchecked-index and exact-optional checks; parsed branded identifiers at boundaries | Build plus web/Node compile fixtures |
| Availability | Bounded input, bounded reads, bounded worker requests and explicit failure | Oversize, timeout, disconnect and corrupt-record tests |
| Responsiveness | CPU-heavy wallet/dust work stays off the page thread | Browser worker heartbeat and independent thread tests |
| State consistency | Immutable UI snapshots, revisions, checked key leases and durable mutation IDs | Stale completion, expiry, reconnect and unknown-outcome cases |
| Maintainability | Focused operation modules; no unexplained size/complexity or unsafe-cast growth | AST budget lint and dependency graph |
| Portability | No DOM/Node dependency in neutral APIs; no credential/global access on import | Consumer build/import checks and browser lanes |
| Integrity | Pinned artifacts, hashes, signed source and DCO; no secret-bearing receipts | Existing package/image/release qualification |

## Commands

Run through the repository's pinned Nix environment:

```sh
nix develop -c pnpm run lint
nix develop -c pnpm run build
nix develop -c pnpm test
nix develop -c pnpm run test:apps
nix develop -c pnpm run test:demo-browser
nix develop -c pnpm run test:coverage
nix develop -c pnpm run quality:report
```

The full pre-commit gate in `AGENTS.md` also type-checks all three apps and checks
formatting. `quality:release` runs lint and all-file package coverage. Required
fast PR jobs retain their existing test shards; coverage and native proof lanes
have separate budgets. A slow or missing required check is not a pass. See
[CI policy](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/ci.md).

### Coverage means a defined denominator

c8 reads compiler source maps and includes unimported executable authored sources
from every non-private package. The receipt records the source commit, dirty
state, Node version, file inventory, per-package counters, exclusions, thresholds
and failures. Raw counters decide the threshold, not rounded display percentages.
A missing executable source record fails even when the aggregate looks healthy.

Generated metadata/binding output, pure type-only emission stubs, account testing
helpers and five retired private scaffold packages are excluded explicitly.
These exclusions do not apply to ordinary untested functions. Root Node coverage
does not cover app UI, hardware passkeys, native proofs, provider acceptance,
Docker restart behavior or wallet balances on a real network.

Do not add import-only tests to raise coverage. Test observable contracts and
failure recovery. New edge cases should cover malformed/oversized inputs, zero
and maximum amounts, stale revisions, concurrent requests, cancellation, late
responses, provider failures and cleanup after partial initialization.

### Static analysis

`lint` combines dependency/circuit checks with TypeScript AST analysis of authored
package and demo sources, the demo journey runner/phases/catalogs, and every
`.mjs` module under `scripts/consumer`.
The consumer inventory is recursive: adding a nested helper includes it in lint
without maintaining another file list. New modules default to 600 lines, functions to 150 lines
and cyclomatic complexity to 25. Explicit `any`, non-null assertions, double-
`unknown` casts and `@ts-ignore`/`@ts-nocheck` have zero default allowance.
Compiler-checked `@ts-expect-error` negative type cases need a clear explanation.
The explicit-any metric also visits actual JSDoc type trees, counting `any` and
the equivalent `*` wildcard once even when the compiler exposes a shared tag from
multiple nodes. Prose and strings do not count; documentation function types do
not become executable functions in the complexity metric. This is explicit syntax
analysis, not a semantic check for inferred `any`, `JSON.parse` or dynamic imports,
and does not claim parity for arbitrary JSDoc unsafe assertions.

`scripts/code-quality-budgets.json` records existing exceptions. They are debt
ceilings, not recommended design. Extracting a proven multi-transaction operation
can retain an explicitly reviewed exception while its ordering is covered.
Budgets are never regenerated by lint and may not grow without a reason/review.
`quality:report` locates each function's lines and complexity for the next cleanup.
The existing `scripts/consumer/public-signer-source.mjs` orchestration has one
explicit legacy function/complexity exception when that directory first enters
the inventory. Its runtime implementation is unchanged; four explicit JSDoc-any annotations
across the consumer tools now use structural types. The exception is debt, not an
exemption for generated templates or future consumer modules. Case admission and
archive PAX/path validation are now separate bounded functions.
The compiler, import graph, AST metrics and tests each catch different defects;
this is not a security audit or a proof of absence of floating promises.

## Test layers

| Layer | Required cases | What it cannot establish |
| --- | --- | --- |
| Pure unit | Recipes, codecs, bounds, state projections, branding, error mapping | Chain settlement or provider support |
| Port/use-case | Both arms, exact consent inputs, live-state races, journals and unknown IDs | Real proving/transport implementation behavior |
| Adapter contract | HTTP streaming limits, atomic stores, worker envelopes and owned cleanup | Production host trust or security hardening |
| Browser | Mock/virtual credentials, dialogs, navigation, real workers/IndexedDB and late UI completions | Synced provider PRF behavior or real Midnight balances |
| Source-preview consumer | Copied declared exports, no checkout SDK aliases, Node imports and strict Node/DOM/WebWorker types | Installation, registry provenance or provider support |
| Installed consumer | Packed exports, dependencies and web/Node type/import/build contracts | Full Lace interoperability |
| Native opt-in | Pinned proofs, indexer/prover restarts, observed ACC/wallet state and receipts | Unrun profiles, untested providers or mainnet safety |

Use the [use-case evidence map](../use-case-coverage/) and
[qualification guide](../qualification/) to locate the evidence for each claim.
Record skips, mocks, dirty state and environmental failures. Preserve failed
receipts and clean up only resources owned by the test run.

## Domain and integration

Use `account/validation` to parse `AccountAddress`, `AssetId`, `Recipient`,
`Amount`, `NetworkId` and `BindingId`. The brands are distinct even where values
share the same wire encoding. An ACC address is not an HD wallet address. Zod
parsing is not an ownership or chain-existence check.

Use `account/authorization` to select the configured primary signer or an authenticated full
owner route for one reviewed operation. Authentication does not remove consent;
route expiry must refuse rather than silently choose another signer. See
[owner authentication](../authenticated-owner/) and
[secret custody](../secret-storage/).

The optional `account/background` protocol transports read/computation tasks.
Use a dedicated Web Worker in a browser, or supply a `worker_threads` port in
Node. It bounds outstanding requests, ignores late/duplicate replies and refuses replayed
server requests within its dedicated channel epoch. Do not
use read RPC timeout as a mutation outcome or automatically retry value calls.
Durable jobs and mutation journals remain separate.

The demo now hosts its built-in wallet SDK, HD derivation, subscriptions and dust
sync in an owned browser worker. NIGHT and DUST read their own sync progress;
NIGHT renders without waiting for DUST. DUST has a separate status/timestamp,
in-flight reads are shared and stale completions are ignored after refresh or
reconnect. A DUST failure does not replace NIGHT with zero. Passkeys and blocking consent stay on the page.
Stopping the wallet terminates that worker and invalidates late read results.
Node probes use the same wallet runtime without browser globals. This is a demo
composition, not a replacement for Lace Wallet or an integration with `lace-sdk`.

### Review a reusable operation

Keep public methods about account capabilities and outcomes. Inject environment work
through ports; keep DOM, storage naming, worker startup and consent rendering in the
host or its explicit platform adapter. A Node import succeeding does not provide a
browser credential or make a browser-only operation portable.

For a multi-step operation, use named, typed phases for admission, authority,
material preparation, publication, observation and completion. Share a phase only
when both arms have the same observable contract; P-256 signatures and JubJub
counter/nonce handling need their own ordering. Keep lookup timing explicit: moving
a host lookup before an await can change the operation even when the returned type
stays identical.

Before accepting a change, review these boundaries:

1. **Public input.** Parse unknown data once at entry, distinguish account/asset/
   recipient brands, bound decimal text before `BigInt`, and reject invalid settings
   before credential or network work. A validated identifier is not proof of authority.
2. **Owned state.** Copy admitted bytes and capture invocation options before awaits.
   Preserve intentional live host lookups; do not cache a mutable roster, delivery
   entry or context guard just to simplify a function signature.
3. **Effects.** Keep original request/effect IDs, signing challenges, flow/session
   boundaries and unknown-result fences. A timeout or cancellation is an observation
   failure, not proof that no transaction was submitted.
4. **Errors and cleanup.** Preserve public typed outcomes. Observe rejected cleanup
   results, including promises returned from structural `void` callbacks, without
   indefinitely delaying pending reads. Keep synchronous throw and ownership boundaries
   explicit; best-effort teardown is not acknowledged shutdown.
5. **Tests and evidence.** Exercise a valid control before each isolated refusal.
   Use mutation/race, partial setup, late failure and original-journal continuation
   tests where those boundaries change. Keep synthetic, installed and native receipts
   tied to their actual source rather than inferring equivalence from a test count.

Extract by responsibility, not arbitrary line ranges. New private helpers should
meet the default metrics; legacy ceilings remain visible until the corresponding
large function is actually reduced. Keep public signatures stable unless an explicit
API change is intended and documented.

### Reusable integration contracts

Use the focused guides for actual signatures, strict typed examples and lifecycle rules:

- [Authorization]({{ '/authorization/' | relative_url }}): one reviewed route, owned
  flow snapshots, trusted callback responsibilities and stale-context refusal.
- [Secret storage]({{ '/secret-storage/' | relative_url }}): versioned per-reference
  custody, caller-owned copies, explicit plaintext opt-in and unavailable versus absent.
- [Background tasks]({{ '/background/' | relative_url }}): allowlisted methods,
  unknown reply validation, independent pending limits, timeout and endpoint ownership.
- [Checked configuration]({{ '/api/#source-preview-checked-configuration-contract' | relative_url }}):
  trusted pins, native byte bounds, whole-read deadlines and custom transport limits.

These are library contracts. The [demo guide]({{ '/demo-guide/' | relative_url }})
records its worker, routine-access and critical fresh-passkey composition. Synthetic
contract/browser evidence cannot replace provider, native or production-custody review.

### Async input and byte ownership

A readonly TypeScript parameter does not freeze the caller's JavaScript object.
Snapshot transaction and grant fields before the first await; consent, signed
arguments and journals must describe the same values. Copy device policy bytes
before loading bindings or showing a review. Regression tests mutate original
transfer/grant inputs while a call is pending.

For admitted ordinary byte inputs, make an owned copy rather than retaining a view.
`copySecretBytes` additionally validates actual typed-array length and ignores custom
iterators or shadowed properties at the secret-store boundary. A Node `Buffer`
is also a `Uint8Array`, but its `slice()` shares memory. Tests cover Buffer inputs
so storage cleanup, owner disposal and caller mutations cannot erase each other's
bytes. This is copy isolation, not a guarantee of secure memory erasure.

The required `isContextCurrent()` is a synchronous host lifecycle guard for **both**
routes. Bind it to the selected account/authentication revision and return false when
that scope changes. It runs before review, again before invoking the operation callback and after private
reads; the SDK cannot infer UI selection from an immutable account object.
Mutation acknowledgements remain available after a later context switch.

### Copied-source consumer check

Use this after a source build to catch public export/type/import regressions before
packing or publishing:

```sh
nix develop -c pnpm run build
nix develop -c node scripts/consumer/preview-quality.mjs --output /private/tmp/passport-preview-new
```

Choose a fresh external output directory with an existing parent. The runner copies
the nine packages' manifest-declared files, rejects escaping or missing exports and
SDK links back to the checkout, then strict-checks neutral ES2022, browser DOM and
WebWorker consumers. Node resolves every public runtime export and imports the selected integration
modules without accessing browser capabilities. Resolving an export is not the
same as executing its module; the installed-consumer lane checks those imports
separately. An owned ephemeral memory secret-store round trip checks copy and
lifecycle behavior; it does not create a persistent vault or background process.

The runner fingerprints and reuses the checkout's physical **external** dependencies.
No package-manager installation occurs. Receipt hashes before and after execution
bind the copied SDK, external graph and tools to that run. This is source-preview
evidence only. Keep packed/installed-package, actual registry, browser worker,
provider and native proof qualification as separate lanes. A Node import succeeding
does not make a browser adapter's credential or storage operations usable in Node.

### Installed current-source quality check

The source-only `scripts/consumer/installed-quality.mjs` checks an **already prepared**
fresh application containing all nine local candidate tarballs. It does not pack,
install, publish, generate keys or start a wallet. Preparation and its independently
recorded bundle/lock hashes belong to the
[installed-consumer workflow]({{ '/qualification/#installed-candidate-interruption-tier' | relative_url }}).
Use the exact source/toolchain corresponding to that candidate:

```sh
CONSUMER_ROOT=/absolute/path/to/prepared-consumer \
RELEASE_VERSION=0.0.0-dev.source.gYOUR_SOURCE_REVISION \
CONSUMER_MANIFEST_SHA256=YOUR_INDEPENDENT_MANIFEST_SHA256 \
CONSUMER_LOCK_SHA256=YOUR_INDEPENDENT_LOCK_SHA256 \
nix develop -c node scripts/consumer/installed-quality.mjs \
  --output /absolute/path/to/prepared-consumer/quality-new
```

Replace the version and hashes with the prepared candidate's exact values. The output
must be an absent, absolute direct child of the consumer; failed outputs are retained.
The runner verifies installed SDK bytes against all nine archives before and after
execution, checks strict Node/DOM/WebWorker fixtures and the maintained public
examples through installed declarations, and **imports** every public JavaScript/JSON
export in an owned bounded child. It rejects SDK resolutions back to the checkout,
missing or throwing exports, compiler-input changes and dependency/tool drift.
Documentation examples retain their declared ambient target and existing declaration
checking policy; the quality fixtures additionally check dependency declarations.

The receipt distinguishes actual module imports from export resolution. It fingerprints
physical dependencies and tools; it does not establish how the installation was
obtained. Pair it with the original build/pack and fresh frozen-offline installation
receipts. Local tarball integrity is not registry provenance, a published release,
provider support, native proof acceptance or full Lace interoperability.

### Installed software-crypto check

Use the source-only `installed-crypto.mjs` after preparing and auditing the candidate
application above. It executes installed public APIs, without a source alias,
TypeScript compiler, demo UI, chain or wallet:

```sh
CONSUMER_ROOT=/absolute/path/to/prepared-consumer \
RELEASE_VERSION=YOUR_EXACT_CANDIDATE_VERSION \
CONSUMER_MANIFEST_SHA256=YOUR_INDEPENDENT_MANIFEST_SHA256 \
CONSUMER_LOCK_SHA256=YOUR_INDEPENDENT_LOCK_SHA256 \
nix develop -c node scripts/consumer/installed-crypto.mjs \
  --output /absolute/path/to/prepared-consumer/crypto-new
```

Choose an absent direct child for each attempt. The command retains a parent
receipt, child results and logs, including partial failures. It checks these six
behaviors on the installed graph:

* Generated ACC execution accepts valid JubJub and strict P-256 signatures and
  refuses changed signed payloads without changing account state.
* Public Lace derivation matches its known answers and network separation.
* Public keyring coin sealing opens correctly and refuses ciphertext tampering.
* The binding's selected Compact runtime matches SHA512 and Keccak vectors.
* The selected Midnight utilities match SHA256 and refuse a changed manifest hash.

The two signature arms are separate cases, making six cases in total. Every case
must pass; a missing, duplicate or foreign case fails even if the child exits zero.
The owned child has a bounded runtime/output budget. Input, installed SDK/dependency,
lock and qualification-tool hashes are compared before and after execution.

This lane records physical parent/dependency resolutions; it does not approve a
new dependency graph, change overrides or prove compatibility with every version
allowed by a semver range. Keep separate reviewed graph/SRI and build/pack/install
receipts. Its current supported ACC/runtime profile is explicit. A narrow reviewed
wasm-bindgen Node feature probe is allowed only in this crypto lane; the import-only
browser-global guard is unchanged. An unrecognized probe is a harness refusal
requiring review, not a crypto acceptance or an automatic compatibility fallback.

A passing receipt establishes installed software-crypto and in-memory generated
contract behavior on those exact bytes. Native proofs, real passkeys, value movement,
registry availability and full Lace integration need their own acceptance lanes.

### Documentation is checked source

Required lint runs `test:docs`'s checker without executing any example. The
manifest at `docs/examples/checked-snippets.json` assigns every TypeScript fence
and example module to neutral ES2022, browser DOM, WebWorker or Node. New fences
must enter that inventory; a deliberately incomplete fragment needs an explicit
reason. Complete examples have no injected globals or hidden host declarations.
The compiler uses the current public source exports, strict unused/index/optional
checks and the selected runtime's ambient types. Diagnostics point back to the Markdown source line. Use
`node scripts/docs/snippets.mjs --json` inside Nix for a receipt with exact
snippet hashes and target results.

This checks the current source, including examples of APIs already present in RC7;
it does not reinstall or verify the RC7 artifacts. The published-consumer lane
checks released packages separately. A compiling integration module still needs
real host ports, reviewed user actions and the documented runtime capabilities.

Authored imports must use public ESM SDK exports or the checked documentation
modules. Ambient declarations, reference directives and suppression comments
cannot supply missing host helpers or change the chosen target. This is a source
contract check for maintained examples, not a sandbox for hostile TypeScript.


## Documentation quality gates

Library contracts and the reference demo have [separate starting points]({{ '/' | relative_url }}).
Every site TypeScript example and both complete example modules are compiled from
a checked inventory against source public exports in the declared neutral, DOM,
WebWorker or Node context. Required lint runs this without executing code or
installing dependencies. This catches source API drift; it does not validate a
registry installation or a real provider.

After Jekyll, the Pages workflow checks local rendered targets and HTML anchors
before uploading the site. Its small Python fixture suite also runs there, outside
the fast PR runtime gate. The checker reports missing assets, base-URL mistakes,
duplicate IDs and out-of-tree targets; it does not fetch external links or qualify
CSS/layout/deployment. The [source documentation runbook](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/site/README.md)
contains the reproducible commands. Owned desktop/mobile browser checks remain a
separate review step for navigation, readable layout and overflow.
