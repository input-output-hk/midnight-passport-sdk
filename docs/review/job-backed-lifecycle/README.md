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


## Partial native execution — 2026/10/28

**Incomplete: the native suite failed its host-capacity guard.** Signed source
`a4c3d4fb0483ac7da71174b002f7e9749cf116ab` completed Jubjub creation/reopen,
standalone grant/holding population and survivor enrollment. Owner and survivor
opened the current viewing key; one qualified seven-unit mock shielded holding
and one active caller-pinned read grant stayed valid.

Target enrollment reached the actual `add_device_with_jubjub` post-submit host
exit, before owner acknowledgement. The real indexer outage probe reported one
unknown original effect. The next host restart was refused below the existing
2 GiB free-space guard, so **original-ID recovery was not qualified**. Source,
compiled runtime and reference end hashes remained unchanged. The final protected
snapshot has 22 jobs, 31 single durable dispatch claims, 30 confirmed host steps
and one retained running original target job. Independent instrumentation has
31 submit entries and no repeated prepared-byte entry. These counters do not
claim a completed lifecycle or permission to replay the pending effect.

Removal, survivor rotation, wallet reconnect, every P-256 native case and every
ARM64 image lifecycle case remain pending. The production image
`sha256:2a41b3b40772c714f9bbe9efed84ad89022fa14ee44dc6099fa54c72107e8ddd`
passed source/runtime (291 files) and locked Linux dependency checks (nine selected
entries). It has not passed the new native lifecycle suite. The pre-execution full
gate passed 984 tests with seven existing skips and zero failures; docs built
21 pages with 462 valid local links/anchors. See [the receipt](qualification.json).

No original uncertain intent, fixture, ledger state or proving key was deleted.
Private fixtures/raw logs were backed up separately with SHA-256 and gzip CRC;
only public/hash receipts belong in the knowledge base. Container shutdown was
requested for the exact three owned IDs; Docker became unresponsive, so shutdown
must be verified before reuse. Do not restart Docker globally over unrelated
stacks. Neither generic storage failure nor a repaired ENOSPC event is claimed.

Before resuming, free **at least 15 GiB** on the fixture/repository filesystem,
check Docker responsiveness and verify recorded owned IDs/volumes. Inspect and
reconcile the retained target effect using its exact original intent and prepared
bytes with explicit software approval; never execute a replacement or infer no
send. Preserve this failed suite. Fresh complete qualification needs a new root,
new signed-input freeze and both-arm source/image results. Published RC5,
exact-value shielded withdrawals and real-provider/full-Lace limits are unchanged.


The follow-up documentation gate exited early with code7 during disk exhaustion;
its exact Node exit cause is not diagnosed. A separate cleanup-metadata write
raised ENOSPC. These partial-result documentation edits require a fresh full gate
before GPG/DCO signing; the earlier implementation gate does not qualify later
edits. The implementation remains `a4c3d4f`; a subsequent documentation commit
does not requalify native execution. Retry validation results and commit
signatures are retained in the owner's dated knowledge-base artifacts. Resume
native qualification only after the capacity and Docker checks above succeed.


## Resume and readiness incident — 2026/10/28

After the user approved a Docker Desktop restart, all original IDs, images and
volumes were verified. The original enrollment intent completed through explicit
same-ID recovery at signed `db2fc84`, retaining prepared bytes and a single
original dispatch claim. All 22 jobs became done, all 31 steps confirmed, with
31 total instrumented submit entries: recovery added no submission. The holding,
active read grant and all three enrolled readers passed. A separate recovery
receipt and protected post-recovery archive retain this evidence; the original
source-v1 suite remains FAIL.

A fresh source-v2 did not qualify. Its initial deployment received node error 171
and stayed unknown. Inspection showed the indexer's tip still at height 7122,
time 15:55:24 UTC, while the canonical node had advanced after Docker restoration.
The failed transaction's DUST time was 15:55:24 UTC and its intent TTL 22:12:35 UTC.
The indexer and node shared genesis and history through the checked height 7100,
but their hashes differed at heights7120/7122. The recovered original enrollment's
confirmation at height 7058 matched the canonical node during diagnosis.

Restarting only the indexer did not repair this divergence: it repeatedly logged
`unexpected block` height 0 while retaining height 7122. Its original stopped
container and volume were archived under retained names; a new cache on the same
pinned image now reindexes the existing canonical node. Source-v2's unknown
original intent and bytes remain preserved. No chain reset, replacement send,
key regeneration or dependency upgrade occurred.

Review `scripts/qualification/indexer-readiness.mjs`: before a qualification
wallet can build, the node's finalized hash/height must be present in the indexer
with a fresh millisecond timestamp. Both native runner families use the guard;
its negative controls reproduce stale/forked readiness. This change does not
relabel prior runs, or by itself qualify the remaining lifecycle/image cases.
