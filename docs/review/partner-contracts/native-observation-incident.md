# Native payment: confirmed effects after an observation timeout

At signed source `23b1d73f096b3d98108f13d9c70b4aad2e2e2703`, the installed
`0.1.0-dev.20261105.merchant.4` consumer reached a real composed payment.
It retained every serialized transaction before sending. The worker subsequently
ended with an observation timeout; its failed fixture remains unchanged.

Independent read-only reconciliation established:

- The original payment is `SUCCESS` in canonical finalized block 22738.
- The ACC holds 8 base units of NIGHT after its 12-unit deposit.
- The configured merchant counter is 1; the wrong-caller merchant remains 0.
- A cold, synchronized view of the original recipient holds exactly 4 units, with
  no pending coins.
- Both original wallets and all three run-owned containers stopped. Source/end
  identity and all 21,854 pinned consumer input bytes match.

This is evidence of the original successful payment and subsequent observation
recovery, **not a successful full qualification run**. Replay, post-call business
failure, revocation and expiry had not yet run. The original approval was not
persisted separately, so it must not be invented as a recovered byte-identical
approval. No successful payment is resubmitted to finish the suite.

## Continuation and observer correction

The opt-in worker can prepare a **separate test intent** from this exact known
boundary, using a new private output and pinned copies of original evidence.
`resumeFrom` must be `prior-native-run-v1`; `resumeSourceCommit` identifies the
original source. Pin its operations, parent receipt, wallet cleanup, owner fixture
and all 16 original serialized transactions in `config.files`. All original
transactions must independently be successful/canonical/finalized before any new
mutation. It also verifies the 52 deployed ACC operation keys, retired authority,
live owner commitment at counter 1, ACC balance 8 and original merchant counters.
An incomplete/unknown original send or changed live state refuses continuation.
This is fixture-specific qualification infrastructure, not a public recovery API.

The continuation reuses the deployed ACC and enrolled owner. It creates new
merchant contracts, grantee, recipient and grant. Its distinct 4-unit payment
would reduce the ACC from 8 to 4, and credit the new recipient 4. It never redeploys,
reactivates, deposits again or repeats the original payment. The original merchant
and its recipient remain separate historical evidence. A failed continuation is
retained and cannot be automatically passed through the same recovery boundary.

The worker now retains the first approval before effects. If the live recipient
view times out, it first verifies the original payment's canonical finalized
success, stops that observer and reconnects from its retained synthetic seed.
Only observation repeats: no sender/dispatch port exists in that helper. An unknown
or failed payment refuses reconnect; a second timeout is preserved. Software
wallet reconnect establishes no real passkey-provider recovery or full Lace support.

The continuation's actual acceptance must be recorded after execution. Existing
published packages, images, Pages and RC6 remain unchanged. All amounts above are
smallest base units, not whole NIGHT. Exact-value shielded guards are unchanged.


## Continuation result

The [separate continuation](native-acceptance.json) passed at reviewed signed
`eb240f6`. Its new payment credited a new recipient **4 base** units, ACC **8→4** and new
merchant **0→1**; all seven refusal cases left serialized state snapshots unchanged.
All **16 original** and **6 continuation** transactions reached canonical finality. The live
credit view passed directly in the continuation. Automatic reconnect sequencing
therefore has unit coverage; the original cold-wallet credit recovery remains a
separate live read-only receipt, not an exercised automatic-timeout branch.
The original failed full suite has not been relabeled. All owned compute stopped,
all volumes remain, and the archived indexer’s original running state is restored.
