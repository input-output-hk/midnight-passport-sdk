# Grant profile loss and revocation: review map

2026/10/26. Refs #239/#230/#231. Qualify original-reader reconstruction and explicit
refusals; no new binding, total-loss promise or release.

## Review order

1. Existing `grant-bookkeeping-recovery.ts` / `grant-opening-check.ts`: complete
   stable ledger, trusted origin, derived ID, object/read-key commitments and
   complete distinct parts; no full staged scope or private key reconstruction.
2. Existing Midnight grant adapter: complete live map; missing/wrong openings
   cannot erase active IDs from a preserving rotation.
3. JubJub connector: persist the verified local record after create/directory
   reopen, taking the counter from the current verified ledger.
4. `scripts/qualification/grant-recovery-case.mjs`: shared positive/negative
   assertions, transport/profile-write refusals, selective/all revocation, no secret progress.
5. Generated fixture/tests: shipped contract and real signatures in both arms,
   distinct empty profiles, forbidden old journal ports; unit partial/stale and
   v1/v2 record checks remain separate declared cases.
6. `apps/passport-service/qualification/grant-recovery.ts`: live commitments,
   separate private owner profiles, retained protected-file hashes, qualified
   holding for owner/survivor, single-attempt native owner calls with write-ahead
   requests. Unknown outcomes never become no-send or automatic replay.
7. Explicit parent/worker `grants` profile and catalog; source/reference/image
   fingerprints, bounded owned stack, truthful scope and false broad flags.
8. [Engineer guide](../../site/grant-recovery.md), runbook and compatibility.

## Limits

Another enrolled reader alone cannot decrypt the issuer's records. Grantees receive
owner-decoded seals; automatic discovery is not qualified. Partial/conflicting
publication faults are fast port cases, not induced partial native publications.
Grant issue/revocation are outside the four-intent durable coordinator. Original
software identity and private grantee keys are preserved fixture inputs. No real
provider/full Lace, total-loss or historical-knowledge erasure acceptance.

## Evidence

[Verification](verification.json) records one native round per software arm:

| Scope | Actual signed source | Evidence |
| --- | --- | --- |
| JubJub | `4a45aa0d12aa8edec762845e1ec61a5646ecd899` | Five completed entries from an overall **failed** run; separate end source/reference audit |
| P-256 | `7483786d81b5a743b6a7a7210af24cebda96b2a5` | Explicit single-arm suite **PASS**, five entries |

Each arm reconstructed two grants in fresh profiles, refused an independent
reader and missing/wrong openings before tracked transport/profile writes, rotated, selectively revoked,
then revoked all while retaining the owner, survivor and seven-unit holding.
Together these scopes contain 44 confirmed host transactions with no duplicate
host sends and 34 native owner-call attempts; native setup transactions are
excluded from these counts. Host sends and direct owner calls are distinct.

The JubJub run subsequently failed during P-256 setup at the old fifteen-minute
harness budget. It remains failed. The new P-256 suite uses an explicit arm and a
bounded thirty-minute two-grant setup budget; native TTLs and no-replay rules did
not change. The recorded comparison verifies 1,102 unchanged non-harness inputs,
including SDK, native worker, shared assertions, compiled runtime and reference
inputs. Harness changes are allowlisted with hashes. **There is no same-source
both-arm CLI PASS** and no retroactive relabelling of either receipt.

At P-256 source, the full gate passed 889 tests with seven pre-existing conditional
skips and zero failures; the focused generated-contract suite passed ten tests
without skips. Provider, full Lace, total-loss, native grant crash continuation and
release qualification remain false. Original failed-run private state is retained.


## Later review corrections

The evidence-only commit `eeecad8` preserved all executable inputs from `7483786`.
A later signed merge inherits foundation review fixes to the qualification runner,
receipt validator and tests: independent child context, no inherited preload/path/
filter/shard options, and positive evidence for skipped-result rows. These are
harness corrections, not a rerun or relabelling of the original native evidence.
[Post-review input comparison](post-review-inputs.json) enumerates changed hashes;
SDK, native grant worker, shared grant assertions and compiled inputs remain
unchanged. Documentation/STATE metadata is additional. The newer full local gate
contains one extra catalog invariant test; original source-gate counts remain
historical. Trusted operator/runtime/dependency provenance is still required.


## Final review scope

The later parent validates exact grant assertions/circuit inventory and refuses
symlinks in recheck copies. Refusal accounting measures transport and local profile
writes, excluding ceremonies/key creation/sealing. The injected write control is
currently generated JubJub only. Historical outage receipts do not validate later
exact fault-code mappings. Worker failures are already covered by the parent's
outer tracked-child cleanup; there is no claimed absence of that cleanup.

The live worker intentionally requires its seven-unit fixture holding. The JubJub
record-write fix is accepted for this single-account profile scope; switching one
profile between accounts or conflicting with an existing durable final record can
safely refuse and is not multi-account/profile-continuation acceptance. The
remaining duplicate counter lookup is a nonblocking optimisation, not a change to
ledger authority. No SDK/native grant worker/shared case changed in the final
harness review corrections.
