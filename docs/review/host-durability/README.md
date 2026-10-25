# Host submission and deployment continuation — local review

**Historical-source evidence:** the 90-transaction live receipt predates later
cancellation, frontier, TTL and preparation corrections. Its source pins are not
current-head qualification. Subsequent suites must retain their own exact sources
and scopes; no full restart/provider/release claim is made.

2026/10/23; Refs #230, #231. Parent signed local source `626c6f9`.
This is a separate coherent local commit on the current branch. No push, issue
closure, publication, Docker start, wallet reset or host signing-scope change.

## Read in order

1. [Engineer guide](../../site/host-durability.md): private configuration, explicit
   composition, authenticated RPC, exact state transitions and known limitations.
2. `packages/service/src/host-mutations.ts`: versioned host records, revision
   fencing, write-ahead finalised transaction bytes/watch IDs, resume/lookup rules.
3. `host-mutation-store.ts` and the existing `mutation-store.ts`: domain-separated
   encrypted confidential storage and immutable fsynced CAS revision publication.
4. `host-mutation-route.ts`, `packages/adapter-service/src/host-mutations.ts`:
   authenticated opt-in route, pin/digest/input checks, no legacy fallback and
   explicit same-operation reconciliation. Included hashes and watch IDs differ.
5. `packages/account/src/ports/index.ts` and
   `packages/adapter-midnight-js/src/chain.ts`: optional submission correlation
   forwarded only to the submitter, preserving old implementations and proof metadata.
6. `apps/passport-service/src/host-driver.ts`, `host-config.ts`, reference backend
   and main: actual ledger v9 construction, binding validation, exact deployment
   frontier, successful raw-tx finality, private key/token mounts, opt-in readiness.
7. `tests/host-mutations.test.mjs`, `host-mutation-http.test.mjs`, selected new-process
   tests and `apps/passport-service/test/host-driver.test.ts`: failure boundaries,
   physical runtime serialization/signatures and original authority policy.
8. `scripts/qualification/host-mutation-matrix.mjs` and its worker: full synthetic
   transport fault matrix outside the fast gate. The receipt binds exact source/runtime.

## Findings fixed before commit

- Reconstructing `ContractDeploy` changes its randomised address. Persist the original
  deploy transaction, not just constructor arguments or an authority key.
- A dispatch write precedes every broadcast. A successor fences old producers by CAS;
  dispatching/sent steps only reconcile, even if no response or indexer record exists.
- Private constructor/authority output is committed before chain work. Losing the
  uncommitted plan does not implicitly generate a different authority/address.
- Every planned verifier must match the pinned binding; validate all 52 operations,
  uniqueness, wave payload budgets and final-only retirement before any send.
- Before each wave, compare the original data, balances, complete key map and
  expected authority committee/counter. Drift and lag block continuation.
- The finality source resolves the protocol era, decodes included raw v9 bytes,
  validates the watch identifier and included hash and requires entire `SUCCESS`.
  Failed/partial/malformed/unknown-era records are not accepted as confirmations.
- A cancellation during preparation or a frontier read stops future broadcast. Save
  completed prepared outputs first. HTTP disconnect does not undo an earlier send.
- Flush the deployment eligibility file and parent directory before acknowledging
  host completion, keeping the sponsor's post-restart account scope durable.
- Keep host encryption/authentication keys independent and out of public logs or
  DApp configuration; RPC outcomes expose no plans, authority keys or raw transactions.

## Verification scope

The complete host matrix passed **152 new-process cases**: **108 resumed**, **44 safely
unknown**, across P-256/JubJub and both retirement choices. Unknown cases are not
labelled resumptions. Tests verify no duplicate sends or constructor regeneration,
unchanged committed plan/transaction hashes and retained retirement choices.

The fast lane adds memory/store/HTTP negatives, concurrent-owner fencing,
selected filesystem restart cases, token/configuration checks and actual ledger
constructor/maintenance transaction serialization and signature checks. Real native
plans are round-tripped through the encrypted store before use. Offline verifier
and authority checks cover both arms and both lock choices.

The full matrix's remote transport is **synthetic**, not a chain or proof server.
Its source/runtime receipt and native offline tests are complementary evidence.
Docker was stopped. No new live node, wallet fee/dust, proof, indexer restart,
real passkey-provider or Lace-host acceptance is claimed. Historical 200-case
owner continuation evidence remains at its original source/scope, not relabelled
as a new live host run.

## Next acceptance

The local host receipt/fencing and committed-wave implementation is ready for
review. #230 remains open for proof-backed localnet process/indexer outages,
combined active-grant/holdings fault scenarios and provider/host acceptance.
#231 still owns the declared release suite and three clean repeats; this local
matrix is not that release gate. Default demo owner buttons still use the old
composition. No package/image/Pages publication has occurred.

Uncommitted constructor/key-origin output loss and expired uncertain transactions
remain safe refusals. Records/keys need protected retention, not deletion to retry.
Only local POSIX single-host storage is supplied; run one service per sponsor
wallet. Unknown versions/continuation drivers refuse; completed receipts are
historical. Full Lace compatibility, total-loss recovery and partial shielded
spends remain unsupported. Immutable binding and exact-value guard stay unchanged.

Read [redacted verification](verification.json) for final gate/docs counts and
receipt hashes. Full redacted matrix, signed bundle and checkpoint live in the
owner's Midnight Obsidian milestone hub; no protected journals or wallet state do.
