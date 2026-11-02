# Independent SDK code-quality audit

Audited committed source `0e959a9` on `codex/rc5-publication-record`, 2026-11-02. Read-only inspection, isolated local Node reproductions under Nix; no Docker, real wallet, ledger changes, external mutations, or source edits.

## Confirmed defects

1. **P1: malformed request target terminates shared HTTP service** — `packages/service/src/server.ts:52` constructs URL before its try/catch. A raw request `GET //[ HTTP/1.1` with an accepted loopback Host caused `ERR_INVALID_URL` to escape the async HTTP listener and terminate Node22. Source and log retained beside this report. Parent has created #260 and owns the fix. Acceptance: malformed origin-form/network-path/absolute targets cannot escape the listener, return a bounded 400 response, never route work, and a subsequent valid request succeeds in the same subprocess. Preserve Host, CORS and JSON guards.

2. **P2: same-ID shielded-deposit retry cannot recover an already present result** — `packages/account/src/shielded-deposit.ts:86,93,118`. Each invocation chooses a fresh ciphertext and only searches entries appended after its initial read. Even a deterministic sealer + compliant idempotent sender yields: first invocation succeeds; second identical request returns original tx ID but falsely times out although its exact original entry remains present. A real randomized sealer also produces a different entry for the same request. No duplicate spend was observed; this is an incorrect recovery/result contract and potential operator confusion, not a proven fund-loss exploit. Dedicated issue appropriate, linked to #230/#213/#243. Do not fix by only removing the index bound: retain original submission identity/ciphertext and inspect original receipt, refuse conflicting payloads, and cover process interruption/key rotation. Existing tests cover first send, rotation-before-send and timeout, but no same-ID result recovery.

## Issue-ready quality improvements

### P2 — Add offline contract checks for native consumer bootstrap before wallet/proof work

Evidence: `tsconfig.json` includes tests/**/*.mjs, not copied fixture .js. `scripts/qualify-published-native-host.mjs:392-408` strictly compiles native-core.ts, but `tests/fixtures/published-native-host-bootstrap.js` (442 lines) and public-signer-harness.js are executable JS wiring, outside that check. Latest native review records an ESM HD import failure and then a funded failure from incomplete proving-provider shape (`docs/review/public-signer/README.md:65-73`). The native proof suite found integration defects after expensive setup that an offline contract/import test can catch.

Scope: type/check the selected public host/installed SDK/bootstrap interfaces in a fresh external checked consumer, including actual HD ESM import and transaction proving provider lookupKey/check/prove composition. Separate construction/import checks from native/provider acceptance. Run before Docker start, synthetic wallet creation, or deposit. Prefer extracted typed composition functions so tests exercise production wiring, not duplicated mock wiring. Do not install or regenerate keys in fast required CI.

Acceptance: a deliberately wrong ESM entry and missing lookupKey/check-result type fail before any wallet/send/proof callback; correct pinned composition loads/constructs; external artifacts checked pre/post; fixture JS no longer escapes all relevant checkJs/type gates. Optional consumer lane may be slower; warm required CI gains no registry install. Link #231/#81/#258.

### P2 — Incrementally extract connector lifecycle orchestration under two-arm contract tests

Evidence: `packages/account/src/connector.ts` 2,235 lines and jubjub-connector.ts 1,855; single closures combine creation/activation, keyring publication, enrollment, rotation, account API dispatch, grants and persistence. Keyring completion and rotation are several-hundred-line nested functions (P256 rotation begins819; Jubjub rotation561), with arm-specific crypto mixed with common publication/persistence and interruption sequencing. Existing grant modules and durable-mutation modules show this repo already benefits from bounded operation units.

Scope: extract one cohesive operation at a time behind existing ports; begin sealed device enrollment/rotation lifecycle coordination, retain arm-specific signatures/challenges/consent descriptions. No generic crypto abstraction or public API rewrite. Existing invariant tests become shared fixtures across both arms.

Acceptance: unchanged exports/errors/consent descriptors/circuit order; both-arm positive and interruption/cancellation/unknown-outcome tests; no replacement send after uncertainty; native before/after qualification only for actually touched paths. Record exact authored review map, retain fixture identity, no line-count target. Link #230/#229/#245/#246.

### P3 — Add explicit timing-option bounds to funding/deposit helpers

Evidence: `packages/account/src/shielded-deposit.ts:71-74` and `packages/service/src/wallet-funding-backend.ts:34-37` check only inequalities. NaN passes both tests, creates NaN deadline, and can keep polling forever; Infinity also admits nonterminating confirmation windows. Other current modules already use Number.isSafeInteger validation.

Scope: finite safe positive integer poll/confirmation checks and documented upper bound where host timers require it. Add option-table tests that prove refusal before ledger/sealer/wallet side effects. Do not change already-submitted outcomes or silently shorten an active proof window. Could be a small subtask under #234 and the deposit-recovery ticket rather than separate issue.

## Keep / avoid

Keep package boundaries, exact binding/manifests, typed consent preservation, independent native finality evidence, encrypted retained journals, unknown-ID preservation and guarded resource cleanup. Do not broadly rewrite proven crypto/journal machinery. Do not count synthetic transport/native/real-provider lanes interchangeably. Reconcile existing tracking issues instead of cloning #227/#231/#234 scope wholesale.

## Final bounded audit notes

- Verified timing gap at runtime: `createWalletFundingBackend` accepts both NaN and Infinity options; isolated reproduction/log retained. These are caller-configurable library options, not an unauthenticated remote parameter exploit.
- Reviewed mutation journal/file store, job CAS/admission/expiry, grant bookkeeping recovery, sponsor policy, SDK/host chain boundaries and qualification input verification. No additional confirmed fund-loss, crypto or artifact-integrity defect identified in this bounded audit. This is not a security certification or exhaustive code review.
- Hosted-chain result parsing permits absent/unknown status if a transaction ID exists (`hosted-chain.ts` around127); this deliberately mirrors the separately pinned public host's `assertSubmitted`. Treat strengthening it as a separately designed port-contract decision with supported-host fixtures, not an immediate proven native defect. I did not include it as a confirmed bug or new issue.
- Preserve existing focused tests and native evidence. Current fast gate gives meaningful behavior coverage, but its test count is not a measure of provider, browser or entire-release completeness.
- Parent owns all repository/GitHub changes. No production source, branch, remote object, real credential, wallet, Docker or retained ledger state was changed by this audit. Only fresh private report/reproduction files were created.

Issue-ready drafts: `deposit-recovery-issue.md`, `bootstrap-contract-issue.md`, `connector-maintainability-issue.md`. Fold timing bounds into #234/deposit recovery unless a dedicated issue is preferred. Do not duplicate #227/#231/#234 broad trackers.
