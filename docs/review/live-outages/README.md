# Live durability qualification — local review

Refs #230/#231/#232. Signed parent `11b2a78`; current branch retained, no push or publication.

## Review order

1. [Engineer runbook](../../site/live-qualification.md): dedicated project/ports, original intent,
   exact scenarios, private-state retention, evidence and real-provider matrix.
2. `packages/service/src/host-mutations.ts` and `packages/adapter-service/src/host-mutations.ts`:
   native watch identifiers are tagged 33-byte hex; included hashes/addresses stay 32 bytes.
   Existing v1 32-byte watch IDs remain readable. Membership/receipt checks and no-resend remain.
3. Native ledger regression in `apps/passport-service/test/host-driver.test.ts` and both HTTP
   result shapes in `tests/host-mutation-http.test.mjs`. Legacy 32-byte coverage remains.
4. `scripts/qualification/live-outages.mjs`: exact container IDs/project/service labels,
   loopback ports/owned volumes; bounded readiness/workers; process-group cleanup; original
   plan/byte hash comparisons; source/reference/image evidence; explicit incomplete results.
5. `apps/passport-service/qualification/live-worker.ts`: actual reference wallet/backend,
   SDK owner/chain/host ports, encrypted journals, process-death fault wrappers and real
   raw-indexer outage probes. All synthetic fixture data stays in private owned scratch.
6. `tests/live-qualification-ownership.test.mjs`: shared-project/port/volume refusal without
   Docker. App TypeScript gate includes the qualification worker. Slow proof scenario is
   opt-in in `catalog.mjs`; fast CI does not start Docker or generate proofs/keys.

## Concrete finding

The first live deployment could prepare/prove/balance successfully but could not persist
its finalised transaction: the new host path required 64-character watch identifiers.
The pinned ledger actually returns tagged 66-character watch IDs. Correct only watch-ID
handling; never truncate the tag or loosen hash, address, exact-member or finality validation.
The regression crosses native ledger output, encrypted host persistence and HTTP parsing.

A second live defect affected JubJub known-address opening: it attempted to replace a
write-once directory hint containing original salt/sealed metadata with a smaller hint.
The core now keeps an existing pointer (including a conflicting untrusted pointer) and
verifies the requested account from the actual ledger and sealed inbox. It still saves a
checked hint when none exists. Unit and live address-open checks cover this boundary.

Pending protected owner traces must use their original implementation where possible;
a changed recorded call sequence can refuse continuation. No journal is deleted or
rewritten to work around it. Completed receipts and retained local hints remain usable.

Finality review also requires **all** stored prepared identifiers to appear in included
raw bytes. A single fee/watch ID must not attest a different transaction that omits
the original account intent. Merged transactions may add identifiers. A native raw-byte
negative verifies the missing-prepared-ID refusal; exact hash/era/status checks remain.

The qualification fixture itself supplies an explicit software key-session port for
P-256 rotation and checks session/decoder capability before deployment. Its initial
missing-session refusal is a failed fixture attempt, not a production regression or
provider pass. The SDK rotation guard was preserved. Readiness treats connection
refusal as indexer-down, and runtime fingerprinting handles ESM-only exports.

## Evidence boundaries

The runbook defines create/activation/sealed inbox/open-by-address and viewing-key rotation
with post-submit process death and actual indexer stop/start, in both owner arms, retaining
original inputs/plans/bytes and retirement choice. Holdings and active-read-grant rosters are
empty in this scope; maintenance authority is retired. Other lock choices, combined grants/
holdings faults, removal, prover outages, NIGHT wallet round trips and full release repeatability
are separate qualification. No total-loss recovery or full Lace compatibility claim.

The real-provider matrix records available OS/browser versions and explicit untested Google,
iCloud, independent two-device and synced-restoration cases. Software P-256 proofs are not
provider evidence. No user credential, browser profile or wallet was modified.

Only final source-stable complete runs count toward this declared scope. Development failures
retain their original evidence and protected request state; no chain reset or blind resend was
used to obtain a pass. The dated Obsidian checkpoint records the actual results, redacted
receipts and recovery bundle. Protected logs, fixtures and journals never enter the vault.

The final `verification.json` records actual test/live/docs counts and remaining acceptance.
Published RC5 packages/images/Pages are unchanged. #230/#231/#232 stay open for their broader
criteria; this local slice is not a complete milestone/release gate.
