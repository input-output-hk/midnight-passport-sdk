# Job-backed populated device lifecycle and wallet reconnect

Refs #233/#230/#231/#232/#239. Local qualification on the existing working
branch; no publication or full Lace/provider acceptance. This document describes
the harness. Actual results will be recorded separately after native execution.

## Review map

1. `scripts/qualification/job-lifecycle-spec.mjs`: closed profile/crypto-arm
   inventory, exact original intent recovery, populated reader/grant/holding and
   removed-reader assertions. An arbitrary exception cannot satisfy an outage.
2. `job-lifecycle-run.mjs`: sequential fresh create, standalone population,
   independent survivor enrollment, target enrollment, target removal and viewing
   key rotation, survivor-led rotation, removed-reader refusal, actual built-in
   wallet reconnect, then repeat read/holding/grant checks. Only the dedicated
   retained localnet is controllable. Bounded process groups and capacity guards;
   no uncertain operation is replayed with a replacement ID.
3. `live-host-jobs.mjs` and `native-job-evidence.mjs`: existing authenticated
   immutable history, single dispatch claims, included identifiers, circuit and
   input hashes, exact image/container/volume and source/runtime/reference pins.
   Source submit-entry counters are distinct from image dispatch claims.
4. `apps/passport-service/qualification/live-worker.ts`: actual descriptor job
   ports with native proofs. Source fault exits after the named native submit
   before acknowledgement. Image fault interrupts the software owner's observer
   of a confirmed original job, then the controller kills/restarts the actual
   production container. These are different interruption boundaries. The image
   probe does not change production service execution or durability.
5. `wallet-owner-identity.mjs`, `wallet-reconnect.mjs` and the DApp e2e: actual
   built-in wallet from the synthetic account owner's private key-source seed.
   Stop the sponsor host before standalone setup/payer work. Credit two smallest
   NIGHT units during real indexer outage; same-instance socket reconnect and
   disposal/recreation must retain identity and balance, reject stale handles
   and close subscriptions. Private owner material must remain byte-identical.
6. Cheap negative tests reject stale/foreign/unconfirmed job boundaries, wrong
   original intent, incomplete holdings/grants/readers, unsafe fixture modes,
   missing seeds and arbitrary completion claims. They run in ordinary tests;
   slow native suites remain opt-in, outside fast CI.

## Acceptance and limitations

Both P-256 and Jubjub must use fresh protected roots and the pinned existing ACC
and keys. One chain-verified seven-unit mock shielded holding and one active
caller-pinned read grant remain readable after every completed mutation. Removed
target retains its old disclosed key but cannot open the current viewing key or
submit mutations; independent enrolled survivor stays authorised. This is future
viewing access revocation, not erasure of past disclosure.

Grant/mint/deposit population uses standalone hosted setup and is explicitly not
job-backed. Wallet credit uses a standalone payer, not an ACC withdrawal or a
job-backed transfer. The synthetic account-owner seed is a software key-source
fixture: it does not establish real WebAuthn PRF, synced passkey-provider recovery,
the Lace key recipe or derivation of an HD wallet from an ACC viewing secret.

The new image profile is native Linux/arm64, with locked Linux dependencies and
retained Linux ext state volumes. Previous Linux/amd64 creation evidence remains
separate. macOS bind-backed image journals remain unqualified. No automatic
scanner, distributed wallet lock, persistent budget, no-send repair or journal
compaction is claimed. Keep historical unknown intents, exact-value shielded
withdrawal guard and release/provider limits unchanged.
