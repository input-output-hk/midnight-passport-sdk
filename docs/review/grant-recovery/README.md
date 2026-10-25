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
   assertions, no-effect refusals, selective/all revocation, no secret progress.
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

Implementation/fast checks are in progress. Native acceptance is pending its final
signed-source execution; runner existence does not establish a passed case.
