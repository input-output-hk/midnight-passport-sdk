---
pageClass: comparison-page
---

# What remains for 0.2.0?

**Milestone issue snapshot: 22 November 2026.** The [0.2.0 milestone](https://github.com/input-output-hk/midnight-passport-sdk/milestone/2) has **17 open issues and two closed issues** (#244 and #317). Of the five connected Midnames issues, [#315](https://github.com/input-output-hk/midnight-passport-sdk/issues/315), [#247](https://github.com/input-output-hk/midnight-passport-sdk/issues/247), [#316](https://github.com/input-output-hk/midnight-passport-sdk/issues/316), and [#318](https://github.com/input-output-hk/midnight-passport-sdk/issues/318) remain open because their full acceptance extends beyond the demonstrated local subset. The published package release remains [0.1.0-rc9](https://github.com/input-output-hk/midnight-passport-sdk/releases/tag/sdk-v0.1.0-rc9). Merged source and local receipts do not qualify an online network, real passkey provider, or a new release.

The milestone groups candidate work; it does not commit every Passport v1.0 promise to one SDK release. [Architecture conformance](/architecture/conformance) maps the implemented subset to the broader target. [The host guide](/guides/hosts#midnames-source-preview) links the local operator and demo recipes.

## Current Midnames delivery

| Journey | Current evidence and implementation | Remaining acceptance |
| --- | --- | --- |
| Name → ACC resolution · #315, #247 | A host-injected Midnames 2.1.0 reader checks canonical `.night` names, the configured registry, a contract target, and the pinned activated ACC binding. The local demo checks each supported-target lookup against a separately pinned finalized node block. A second self-hosted local indexer returned identical registry and ACC state bytes at one pinned block and the same known name-to-ACC result through the two-provider resolver; the indexers share one node. | An independently known online name-to-contract mapping, authenticated online provider agreement, authoritative chain-state proof, and the proposed MIP-0007 operation-context resolver. The transitional single-contract registry does not supply public `passport.night` ownership. |
| Post-ACC claim · #316 | [PRs #361](https://github.com/input-output-hk/midnight-passport-sdk/pull/361), [#364](https://github.com/input-output-hk/midnight-passport-sdk/pull/364), [#368](https://github.com/input-output-hk/midnight-passport-sdk/pull/368), and [#370](https://github.com/input-output-hk/midnight-passport-sdk/pull/370) deployed the pinned local registry, corrected overclaimed storage-deletion gas credit, finalized root-assisted and paid user-owned names, and added an optional post-activation claim UI with sponsor-issued pre-proof quote and saved-claim reconciliation. A quote-bound isolated Chromium fixture recovered one original after a lost response. A signed local run at `46add31e` qualified one actual Passport page claim with sponsor-issued pre-proof quote, proof, reviewed send and same-profile lost-response recovery. A later isolated run at signed `e3ec3608` [passed same-profile release-to-retry](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/release-ledger9-page-same-profile-20261120.json). Signed `4a6c7642` then [passed both page-owned originals](https://github.com/input-output-hk/midnight-passport-sdk/blob/7c9acc2bf9b6a9a996ff7a95b0b40954376689c8/examples/midnames-local/evidence/release-ledger9-page-two-originals-20261120.json): two quotes, proofs, preparations and one dispatch each in one persistent profile; canonical fee-only claim failure, exact sponsor archive and browser release; then indexed success to the same ACC after a lost response. | A prepared claim is not registered until its exact original finalizes and the registry binding is verified. The earlier two-original retry run supplied an already activated ACC through a fixture login. A later one-head local run created an ACC and claimed a new name in one persistent synthetic-passkey browser profile. Real-provider consent and same-name continuity after total credential loss remain unqualified. |
| Independent named receive · #317 | [PR #365](https://github.com/input-output-hk/midnight-passport-sdk/pull/365) qualified a separate sender resolving an existing `paidfix.night` claim on shared Ledger 9, approving the exact destination in its own browser, and finalizing a shielded 10-unit synthetic-token ACC deposit. The saved development mock-passkey owner reopened the same ACC and read the matching chain-verified holding ([redacted receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/shared-ledger9-paidfix-deposit-20261118.json)). | Human-run review, real passkey/provider consent, online name resolution, and broader negative native/provider cases. This one local deposit does not qualify public `passport.night`. |
| Owner NIGHT send by name · #318 | [PR #366](https://github.com/input-output-hk/midnight-passport-sdk/pull/366) qualified one connected shared Ledger 9 two-leg payment. A [fresh isolated comparison](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/ledger9-night-by-name-prover-comparison-20261122.json) finalized the browser-reviewed synthetic payment on the release node/indexer with the pinned RC compatibility prover: 10/0 → 6/0 → 6/4. A later [isolated hybrid diagnostic](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/stable-hybrid-night-send-20261122.json) completed the same two legs with release prover `9.0.2` after deploying a source with the alternate withdrawal verifier. The opt-in local demo control is in the reference app; a later one-head local browser run claimed a new name and finalized two named payments with original-only recovery. | Stable `9.0.2` still refuses the ordinary Compact 0.35 withdrawal. The diagnostic source retains the old runtime and 51 old verifier keys; it is not a supported binding. The [complete inventory](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/compact036-acc-key-inventory-20261122.json) found 48 of 52 key pairs change with the 0.36 tool. Full artifact/version support, human review, real passkey custody, additional failure/recovery cases, and authenticated online resolution remain open. The ACC signs withdrawal to the bridge; the host checks the name and recipient ACC. |

The [independent local indexer receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/independent-indexer-local-20261122.json) at signed `7b24f180` compares serialized registry and ACC state from two separately stored Indexer API v4 instances at one canonical finalized block, then resolves the same known local name through both. Both indexers attach to the shared node, and this does not qualify an online mapping or cryptographic state proof.

The [one-head local receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/candidate-onehead-create-claim-pay-20261122.json) combines a fresh ACC, paid user-owned name claim and named two-leg NIGHT payments under a synthetic passkey. The browser now also offers a random local `demo-<24 hex characters>.night` suggestion when the user has not chosen a label; it restores an earlier credential-scoped selection instead of replacing it. The suggestion does not reserve or claim a name, and no physical-provider or online qualification follows from it.

A newer [candidate binding native run](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/candidate-acc-named-night-send-20261122.json)
completed the same named withdrawal and recipient deposit using complete pinned
Compact 0.36 ACC assets for **both** accounts and stable prover `9.0.2`.
The root-owned local name resolved to the candidate recipient, both 52-key
rosters matched on chain, and the retained two-leg intent completed with
10/0 → 6/0 → 6/4 balances. This is isolated qualification, not ordinary SDK
or demo admission. The full #316 user-owned claim, #318 browser/provider and
recovery gates, and #315/#247 online mapping remain open.

A shared Ledger 9 proof-only diagnostic at signed `2e53287d` then checked
the previously created candidate ACC's deposit verifier, fetched pinned
`deposit_unshielded` artifacts from an owned loopback key server, and obtained
one unbalanced 4 NIGHT proof from release prover `9.0.2`. The redacted receipt
is in `examples/midnames-local/evidence/candidate-acc-shared-deposit-proof-20261122.json`.
The diagnostic submitted no transaction. At signed `a0617f03`, a later
exported-adapter proof-only run called `proveUnboundNightDeposit` itself: the
adapter fetched the candidate verifier and manifest, compared the deployed and
fetched verifier hashes with the pin, and returned one unbound proof with one
prover call and zero dispatches. Its redacted receipt is
`examples/midnames-local/evidence/candidate-acc-shared-adapter-deposit-proof-20261122.json`.
At signed `0d47432b`, a separate funded synthetic wallet later
balanced and submitted the exported adapter's 4 NIGHT deposit proof after
consuming one exact, previously split NIGHT output. An observer query error
after the split was reconciled against the original transaction before the
deposit. The recipient candidate ACC balance moved from 0 to 4 at an indexed
finalized block. The redacted receipt is
`examples/midnames-local/evidence/candidate-acc-shared-adapter-settled-deposit-20261122.json`.
This was one native deposit to an existing ACC, before the connected browser
source withdrawal and combined two-leg run below.

A later [connected candidate browser run](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/candidate-connected-browser-night-send-20261122.json)
created and funded a fresh synthetic-passkey ACC on the shared Ledger 9 chain,
funded its separate device wallet, and finalized DUST registration. It reviewed
`codexacc22.night` against the pinned registry and recipient ACC, then withdrew
4 NIGHT and deposited that exact output into the recipient. The original
withdrawal and deposit finalized at separate blocks; after browser restart,
the same journal archived both IDs and the ACC balances were 6 and 28. The
diagnostic fixes and recovery span signed source heads, and the name was
registered before this run. A later
[one-head local browser receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/candidate-onehead-create-claim-pay-20261122.json)
records a new ACC, post-activation `.night` claim, separate device-wallet DUST,
and a 4 NIGHT payment to a named ACC in one synthetic-passkey profile. Both
original legs finalized; one explicit check archived them. A 1 NIGHT payment
on the next signed head completed automatically after the page waited for
finality. Physical passkey and online provider qualification remain open.

A later isolated candidate
[paid-claim retry](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/candidate-acc-page-paid-claim-retry-20261122.json)
used one persistent Passport page profile to prepare two originals for a newly
activated candidate ACC. The first indexed as failed and was archived; a fresh
reviewed original recovered its success after a lost sponsor response. The
page login connector was a fixture and the naming credential was virtual. A
source-only local profile now pins the candidate in the browser and service,
but the combined real account create/open → claim → named payment journey
remains unqualified.

The shared [local demo launcher](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/examples/midnames-local) attaches to a compatible Ledger 9 stack and does not start it again. [PR #367](https://github.com/input-output-hk/midnight-passport-sdk/pull/367) packaged that setup; [PR #368](https://github.com/input-output-hk/midnight-passport-sdk/pull/368) enabled optional registration and NIGHT funding with distinct sponsor and funding wallets. The browser must explicitly confirm the saved claim before sending. A prepared receipt is not an issued name.

A [fresh isolated diagnostic](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/stable-withdrawal-036-key-probe-20261122.json)
received nonempty withdrawal proof bytes from the stable `9.0.2` prover with
the 0.36-generated key pair and the exact synthetic browser-reviewed witness.
The existing ACC retained its old verifier key; the diagnostic stopped before
transaction completion or payment dispatch. A second run held the exact
withdrawal preimage fixed: the old pair returned HTTP 400 and the new pair
returned nonempty proof bytes. A later hybrid deployment with a matching
withdrawal verifier completed a full indexed two-leg run on `9.0.2`, but
#318 still needs a complete versioned binding and supported-profile gates.

A [subsequent isolated full-roster diagnostic](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/stable-full-roster-night-send-20261122.json)
deployed all 52 alternate verifier keys on a fresh source ACC and repeated
the indexed 10/0 → 6/0 → 6/4 payment with stable `9.0.2`. This confirms the
complete on-chain verifier roster for that route, but the current SDK cannot
restore or select it as a supported binding. The old module/runtime and ZKIR
were retained, and other ACC circuits are unqualified. The
[version-axis decision](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/adr/0020-ledger9-acc-key-generation-binding.md)
keeps the old binding intact while the candidate receives its own artifacts,
restoration path and host checks. #318 remains open.

## Merged recovery slice and remaining gates

[PR #370](https://github.com/input-output-hk/midnight-passport-sdk/pull/370) merged the source preview. At signed `3de4da8`, the full local Nix gate, independent exact-head review, [20 hosted core jobs](https://github.com/input-output-hk/midnight-passport-sdk/actions/runs/44465556996), and both image checks passed. It adds exact-original local funding recovery, finalized and same-block local name-to-ACC checks, a [Compact 0.36 read-only registry probe](https://github.com/input-output-hk/midnight-passport-sdk/blob/fd8919e961a34ca0fbfae2387be78039a208040d/examples/midnames-local/evidence/compact036-readonly-20261119.json), browser-to-sponsor pre-proof quote and saved-claim reconciliation, busy-before-proof refusal, and release of an older quote only after exact sponsor proof that it never reached wallet balancing. A [Preprod indexer proxy](https://github.com/input-output-hk/midnight-passport-sdk/blob/3de4da88852ff885e3d597a6b1337aa84242f5ed/examples/midnames-online/README.md) keeps a Blockfrost project ID on the host for an optional read-only profile. A separate host check anchors two tokenless v4 indexer reads and one operator-supplied known mapping to the same node-finalized block. The proxy and checker have synthetic/local-browser evidence only; neither qualifies a live public provider, independent backend, or online name.

All 13 Compact 0.36 ZKIR/prover/verifier key hashes match the pinned Compact 0.35 registry, and the 0.36 reader decoded an existing local name. No 0.36 proof, gas-balanced write or native 0.36 claim, second independent online indexer, or known online name-to-ACC mapping was qualified. The deployed 0.35 guard remains. Pending claim and funding operations require reconciliation of their original IDs; [#369](https://github.com/input-output-hk/midnight-passport-sdk/issues/369) tracks the legacy funding cases.

[#363](https://github.com/input-output-hk/midnight-passport-sdk/issues/363) still tracks isolated reproduction of the recorded Compact 0.35 rejection and a fresh, separately pinned 0.36 native proof/write path if needed. [#334](https://github.com/input-output-hk/midnight-passport-sdk/issues/334) still tracks the complete failed-claim and browser-owned retry matrix. Legacy funding reservations remain pending under [#369](https://github.com/input-output-hk/midnight-passport-sdk/issues/369); missing ACC transaction IDs alone cannot prove non-submission. PR #370 adds a future pre-submit marker and exact-request release, but its real failure/recovery and those older records remain separate work. None of these open gates justifies replaying an uncertain original, clearing browser data, or resetting the shared chain.

A local source preview adds bounded sponsor archive lookup for the exact
quote, owner-bound refusal of a sibling quote, and indexed-failure archival
before browser-owned retry release. Its unit tests and a headless Chromium
outage/retry path pass. A later isolated release-stack run using a pinned
Ledger 9 `1.0.2` reference client finalized the original fee-only claim
failure, archived the exact sponsor journal, released the browser record after
reload, and finalized a fresh paid claim to the same ACC. The fresh proof and
dispatch were host-driven in that run. A later signed `b58668e8` isolated run
sent the fresh prepared claim once from the reference browser through the
sponsor HTTP fence, recovered after a lost response and browser restart, and
confirmed indexed success to the same ACC. Quote issuance, owner proof, and
balancing remained host-driven, with separate browser profiles for release and
retry. Signed `e3ec3608` later qualified page release and successful retry in one profile after importing the fixture-prepared failed original. Signed `4a6c7642` then [qualified both preparations in one page profile](https://github.com/input-output-hk/midnight-passport-sdk/blob/7c9acc2bf9b6a9a996ff7a95b0b40954376689c8/examples/midnames-local/evidence/release-ledger9-page-two-originals-20261120.json), including exact indexed failure archival, retained browser history, fresh reviewed retry and canonical success to the same ACC. #334 remains open for combined ACC create/open,
real-provider consent, and the negative native matrix; #363 still needs its
separately pinned Compact 0.36 proof/write evaluation.

## Other open 0.2.0 work

| Workstream | Issues | Current boundary |
| --- | --- | --- |
| Credential discovery | [#20](https://github.com/input-output-hk/midnight-passport-sdk/issues/20) | Integrate the source-preview private locator with actual create/open, then qualify ledger mapping, anti-squatting, privacy, and cache-loss recovery. |
| Faster creation | [#23](https://github.com/input-output-hk/midnight-passport-sdk/issues/23) | Decide whether a pre-deployed ACC can safely bind constructor and encryption commitments; measure the reviewed flow. |
| ACC circuits and value | [#82](https://github.com/input-output-hk/midnight-passport-sdk/issues/82), [#201](https://github.com/input-output-hk/midnight-passport-sdk/issues/201) | Qualify remaining typed circuits and safe shielded change/coin reconciliation before partial withdrawals. |
| Recovery and delegation | [#240](https://github.com/input-output-hk/midnight-passport-sdk/issues/240), [#281](https://github.com/input-output-hk/midnight-passport-sdk/issues/281) | Total-loss successor and viewing-key continuity, corrected retirement, and complete bounded-session security/provider gates remain. |
| Proving and connections | [#241](https://github.com/input-output-hk/midnight-passport-sdk/issues/241), [#242](https://github.com/input-output-hk/midnight-passport-sdk/issues/242) | Measure current-ledger browser proving and specify origin-attested dApp/agent connection and consent. |
| Network and asset scope | [#243](https://github.com/input-output-hk/midnight-passport-sdk/issues/243) | Qualify each additional network and asset separately. Completed [#244](https://github.com/input-output-hk/midnight-passport-sdk/issues/244) records the [P1–P10/C1–C26 adoption gates](/architecture/adoption-gates). |

<span id="next-seven-issue-delivery-goal"></span>

## Next qualification sequence

1. Reproduce and diagnose the recorded Compact 0.35 rejection on an isolated chain, then qualify a fresh, separately pinned 0.36 proof/write path if needed. Keep the recorded originals and the running shared demo intact.
2. Qualify combined ACC create/open followed by the page-owned claim. The current isolated native pass prepares both originals in one persistent page profile but supplies an already activated ACC through the fixture connector; retain both original IDs through each failure boundary.
3. Qualify a known live online contract mapping with authenticated, replaceable Indexer API v4 providers before enabling any online profile. Treat MIP-0007's delegated resolver and public `passport.night` namespace as separate upstream dependencies.
4. Recheck the five issue criteria at the exact merged source and close only the demonstrated subset or record the remaining acceptance explicitly. A local synthetic credential does not qualify a real provider or human approval.
