# Release quality backlog

Baseline: `b66e946f412dfc871d19d98804ccd90efa332149`, current branch
`codex/rc5-publication-record`. This is local release work, not a published claim.

The product is nine reusable packages for hosts such as Lace. The demo demonstrates
composition; neither its UI nor its wallet is a required SDK dependency.

| ID | Deliverable for this release | Acceptance evidence | Status |
| --- | --- | --- | --- |
| Q1 | Cohesive connector operation modules; prevent new large files and complexity growth | AST inventory, operation regression tests for both arms | Implemented; acceptance below |
| Q2 | All executable authored package files in coverage; 80% lines/functions/branches | Fresh coverage receipt, missing-file and threshold negative controls | Implemented; acceptance below |
| Q3 | Zod boundary parsers and distinct branded domain identifiers | Rejection, range, round-trip and compile-time misuse tests | Implemented; acceptance below |
| Q4 | Wallet SDK/dust work off the UI thread; independent NIGHT/DUST observations, bounded requests and cleanup | Real worker transport tests; browser responsiveness and teardown | Implemented; acceptance below |
| Q5 | Clear domain ownership, dependency wiring and execution model | ADR and integration examples; dependency lint | Implemented; acceptance below |
| Q6 | Web and Node consumer contracts | Existing consumer lanes plus new API imports/type fixtures in both targets | Implemented; acceptance below |
| Q7 | Published package quality attributes and test strategy | Engineer guide with exact gates, limits and commands | Implemented; acceptance below |
| Q8 | Static analysis with enforceable budgets | AST lint and deliberate failing fixtures; no unexplained suppressions | Implemented; acceptance below |
| Q9 | Host-owned consent and explicit authenticated-owner route | One reviewed route per operation; expiry, switch and receipt tests | Implemented; acceptance below |
| Q10 | Async secret-store port and reference adapters, Lace custody ADR | Copy isolation, scope, conflicts, deletion and failure contract tests | Implemented; acceptance below |

## Baseline evidence

`review/quality-baseline-coverage.log` records 1,019 passing tests, five existing
skips and loaded-only coverage: 95.61/94.18/85.33% lines/functions/branches.
`review/sdk-quality-c8-baseline/` adds unimported source files using c8: initial
91.66/91.72/83.97%. These are different denominators, not a regression.
Type-only modules, generated binding metadata and test helpers need explicit
classification; none of these measurements establishes native or provider acceptance.

Largest authored package files are `account/src/connector.ts` (2,259 lines) and
`jubjub-connector.ts` (1,932). Large demo and qualification files also exist.
The first extraction must preserve circuit ordering, live-roster checks, unknown
submission IDs and receipts. Splitting a file does not itself improve correctness.

## Release invariants

- No partial shielded spends; retain the exact-value guard.
- Local owner lock/expiry does not revoke durable on-chain ownership or grants.
- No automatic passkey fallback after approving an authenticated JubJub route.
- A submitted operation's receipt survives a later local lock or timeout.
- Passkeys and consent remain in the host UI; worker messages never invoke credentials.
- Secret persistence is explicit, optional and not required for deterministic PRF recovery.
- Plain browser storage is a reference adapter, not a hardened wallet vault.
- No additional package, replacement of Lace orchestration or full Lace-compatibility claim.

Keep each item's verification and remaining limits here as implementation lands.

## Follow-ups retained explicitly

These are non-blocking quality debt, not claims of completed qualification:

- Q1 follow-up: continue splitting remaining connector lifecycle/grant coordination
  and the demo's large app/UI/browser-journey modules. The release extracts two
  cohesive operations and ratchets remaining complexity; it does not erase legacy debt.
- Q4 follow-up: live browser wallet sync under a real indexer/DUST outage and
  browser-specific DUST cap semantics. This tranche tests real worker/IndexedDB
  wiring, synthetic delayed DUST and actual SDK import/build; no new native proof
  or real-provider run is claimed.
- Q8 follow-up: assess typed floating-promise lint separately. The current gates
  enforce strict/unused compilation, dependency boundaries and AST budgets;
  they are not a complete semantic linter or a security audit.
- Q10 follow-up: production encryption/keychain/provider identity, quota/eviction,
  private browsing and an actual Lace storage protocol. Plaintext reference custody
  and a future provider seam are the explicitly requested scope.

The existing partial-spend, interoperability and native-provider limitations remain
in their original backlog. No new release or publication is implied by local acceptance.

## Local acceptance — 2026-11-07

Candidate implementation is based on the baseline above; initial receipts honestly
record dirty source. No package, image or docs publication is performed by this tranche.

- Full AGENTS gate: `review/sdk-quality-full-gate-v6.log`, **1,413 passed / seven
  existing skips / zero failures** (1,063 root, 172 demo, 171 service, seven funding).
- All-files coverage: `review/coverage-1794014779286/summary.json`, **139 executable
  files**, **93.47% lines / 92.26% functions / 84.48% branches**. All nine packages
  clear 80% for each metric; inventory/threshold rejection controls pass.
- AST inventory: `review/sdk-quality-ast-final-v2.json`, 217 authored package/demo
  files. No explicit `any` or suppression; 331 legacy non-null assertions and 41
  double-unknown casts remain under recorded ceilings. The P-256 root fell from
  2,259 to 1,778 lines; JubJub from 1,932 to 1,722. Six files still exceed 600 lines.
  This is a measured reduction and ratchet, not a completed rewrite of legacy roots.
- Mutable-input review found that transfer descriptors could reread caller DTOs
  after awaiting a binding, and grants could retain a mutable scope during review.
  Connectors now snapshot fields so reviews, signatures and journal records match.
  Both arms and shielded/unshielded regression cases mutate pending inputs.
- Byte ownership review found `Buffer.slice()` could alias a retained seed or
  storage temporary. Owned Uint8Array copies and Node Buffer mutation/disposal
  cases now guard secret-store, owner seed, device policy and legacy rotation.
- Lazy adapter instances now remain stable across concurrent use; failed loads can
  retry. Directory responses have bounded streaming, field schemas and timeout.
- Real Chromium worker/IndexedDB contracts passed with resources closed:
  `review/background-quality-1794014772330.json`. Actual SDK import and production
  worker/WASM build pass; synthetic CPU/balance cases are not live sync acceptance.
- Pinned actionlint passed. Final browser/installed consumer/docs and independent
  signed-head review receipts are retained in the Obsidian checkpoint packet.

Four minimal function-line ceiling adjustments are explicit in the budget file:
three lines in the P-256 root, one in each grant-issue operation and two formatted
lines in device-keyring. They add input ownership checks/copies found in review;
no unrelated complexity allowance was added. Remaining ceilings are measured debt.

The release-scoped Q1–Q10 deliverables above are implemented locally. The explicit
follow-ups remain backlog, including live browser/DUST acceptance and hardened
custody. Re-run release gates at the actual publication head; local tarballs do
not establish registry availability or package visibility.

### Independent candidate review correction

The read-only review of `b0170aa` found a P1 contract gap in the new public
consent router: a primary account object stays A when the host selects B, and
there was no host-selection guard to observe that change. The correction adds a
required synchronous `isContextCurrent()` on both routes. It refuses before dispatch
on selection/authentication revision changes, discards stale private-read results
and retains already-dispatched mutation acknowledgements. Seven regression cases
cover both routes. Fresh follow-up gates and review are archived separately;
initial receipts remain evidence for the initial candidate, not the correction.
