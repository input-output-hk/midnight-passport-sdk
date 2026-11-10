# Pre-RC code quality and architecture audit

Baseline: merged prototype `22591020deda3c5aef7035bdad245a54de7c9df6`.
The product remains nine reusable packages; the reference apps own UI, wallet
startup, consent wording and deployment policy. This is source-quality work for
the next release candidate, with release qualification recorded separately.

## Baseline and priorities

All executable authored package sources pass the existing 80% line/function/branch
threshold globally and per package: **95.27 / 94.06 / 87.42%** overall. The baseline
coverage run has 2,059 passing root tests and five existing skips. This denominator
does not include reference apps, native proofs or passkey providers.

The AST inventory covers 350 files. Largest roots: demo app 1,392 lines, JubJub
connector 1,040, demo UI 1,032, P-256 connector 762. Large composition functions
remain measured debt. Thirty-one backend app sources are currently outside this
gate; eight exceed at least one default metric. The native reference driver and
loader also contain explicit dynamic-runtime escape types.

| ID | Priority | Deliverable | Acceptance | Status |
| --- | --- | --- | --- | --- |
| QA1 | P2 | Parse architecture import edges with the TypeScript AST, including bare Node built-ins and cross-package relative imports | Negative controls for bypasses; comments/strings do not become imports; current package graph still passes | Implemented locally; acceptance scoped below |
| QA2 | P2 | Separate JubJub readiness/binding and operation composition from connector wiring | Smaller roots and cohesive helpers; both signing arms, creation/reopen, grants, holdings and device regressions | Implemented locally; acceptance scoped below |
| QA3 | P2 | Extend AST checks to backend apps and reduce their newly measured size/complexity debt | Node app inventory included; no increased existing ceilings; remaining dynamic native bridge debt explicitly described | Implemented locally; acceptance scoped below |
| QA4 | P2 | Bound and validate remote host-confirmation JSON before decoding ledger bytes | Positive confirmation plus oversized, malformed, aborted and partial-response cases retain unknown outcomes; no replay | Implemented locally; acceptance scoped below |
| QA5 | P2 | Bound decimal text before funding-policy/value-call BigInt conversion | Uint128/Uint256 maximum and malformed/oversized input cases; unchanged accepted limits | Implemented locally; acceptance scoped below |
| QA6 | P3 | Update developer quality/architecture guidance and record before/after results | Full local gate, per-package coverage, browser journeys, documentation checks and independent committed-head review | Implemented locally; acceptance scoped below |

## Architecture decisions retained

- Keep explicit ports and per-operation orchestration. Do not replace durable
  transaction journals with a generic UI state manager.
- Keep browser credentials and consent on the UI thread, and wallet/DUST work in
  the existing worker composition. Worker read timeouts do not authorize retries.
- Keep default strict P-256 signing, reviewed PRF-only JubJub creation, routine
  reader/wallet leases and full-owner authority distinct.
- Preserve original request IDs, exact shielded values, live ownership/roster
  checks, post-dispatch receipts and known unknown-outcome fences.
- Preserve package/API compatibility and intentional live port lookups while
  extracting operations. Moving a lookup across an await can change its meaning.
- Use the existing pinned dependencies. Source/build, synthetic browser, native,
  provider, installed-consumer and release evidence answer different questions.

## Deferred quality work

The large demo UI/composition roots, full structural typing of the dynamically
loaded native reference ledger, semantic floating-promise lint, production secret
custody and genuine provider/native interoperability remain explicit follow-ups.
Their existence does not justify weakening current gates or claiming a completed
rewrite. Any implementation change to the native wallet/proving bridge needs its
own qualification scope before a release claim.

## Implementation review map

- `scripts/architecture-source.mjs` parses literal imports; boundary tests reproduce
  the former Node/relative-source bypasses before verifying their rejection.
- Account helpers separate JubJub capability checks, readiness, grant methods and
  holdings. The root is 594 lines versus 1,040; its factory span is 531 versus 894,
  with four non-null assertions versus thirteen. New modules meet default budgets.
- The expanded AST inventory has 389 files versus 350. Backend source coverage of
  this static gate grows from zero to 33 files. Six of the eight original backend
  metric exceptions are removed through typed admission and cohesive functions.
- The remaining native driver/loader exceptions are exact existing debt: 274/164
  factory spans, native-driver complexity54, and 16/3 explicit runtime escapes.
  Confirmation extraction removes one former `any` and one non-null assertion;
  public package sources still have zero explicit `any`. No existing ceiling grows.
- Host confirmation uses the already pinned Zod4.1.12, now declared directly by its
  reference app. No new dependency version is introduced. The encoded raw field
  remains limited to16MiB; the entire JSON response is limited to17MiB before parse.
  Both header and body waits honor the original four-second abort scope.
- Funding policy limits use at most39 decimal digits before Uint128 conversion;
  tagged value arguments use at most78 before Uint256 conversion. Exact maxima
  remain valid; over-limit and noncanonical values refuse before wallet work.

The native reference bridge and loopback-only demo proxy retain their separate
trust/qualification boundaries. No fresh real-provider, fund-movement, installed
release, production image or Pages deployment acceptance is inferred from this audit.

## Acceptance and release handoff

The local candidate must pass the full lint/format/build/package/app/type gate,
the all-file nine-package coverage gate, both signing arms of the synthetic
browser journeys, worker/IndexedDB contracts, strict public consumer fixtures,
rendered documentation checks and independent committed-head review. Preserve
original failures and source/runtime identities alongside the final results.
These checks qualify their own source/test tiers; a subsequent RC still needs
its installed-consumer, registry, image, native/provider and publication gates
where claimed. The public API and package count do not change in this audit.

The large P-256 and demo roots remain under their existing ceilings. Follow-up
work should extract a complete responsibility with its race/ownership tests,
rather than copy an arbitrary line range or hide dynamic types behind aliases.

The independent review found one extraction regression: readiness read a replaced
network port when saving the local binding, while the connector retained its
original network object. The correction carries that captured object into
readiness. A public-facade regression reproduces the mismatched record before the
fix and verifies matching account/record binding afterwards; it also checks that
activation and the two inbox publications execute once.

A final transport probe also found validation amplification: an array schema
visited every transaction before rejecting an invalid result count. The fixed
one-record tuple refuses extra records before traversing them. Identifier
validation stops at the first malformed item and emits one schema issue rather
than accumulating an issue for every invalid ID. Positive confirmation and
instrumented zero/multiple-record and malformed-ID controls cover these guards;
invalid observations still remain unknown and never enter ledger decoding.
