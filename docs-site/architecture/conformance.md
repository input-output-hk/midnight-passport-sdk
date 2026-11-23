---
pageClass: comparison-page
---

# Passport architecture conformance

**Snapshot: 16 November 2026.** This page compares the merged SDK baseline at [`95244f3`](https://github.com/input-output-hk/midnight-passport-sdk/tree/95244f322741e345698e524294c9b3de0509e086) with the Passport architecture repository at [`9906267`](https://github.com/midnightntwrk/passport/tree/99062671d939641cb9ed9274d3d18fce764d539a). Later source-preview changes are labeled separately. Naming native receipts are source-specific: the browser claim passed on signed `9a19757` (the tree merged in #342), while the latest named-value runs passed on earlier signed `d492487` (the tree merged in #341). The [rendered architecture site](https://midnightntwrk.github.io/passport/site/) introduces the product; its [arc42 reference](https://github.com/midnightntwrk/passport/blob/99062671d939641cb9ed9274d3d18fce764d539a/docs/arc42.md), [v1.0 promises](https://github.com/midnightntwrk/passport/blob/99062671d939641cb9ed9274d3d18fce764d539a/docs/plans/PROMISES.md), and [component inventory](https://github.com/midnightntwrk/passport/blob/99062671d939641cb9ed9274d3d18fce764d539a/docs/plans/components/README.md) define the comparison. The architecture describes a **v1.0 target**, not a declaration that every component already ships in the reference repository.

Here, **implemented subset** means this fork has a source path for the named operation and its documented prerequisites; it does not claim full promise or MIP conformance. **Partial** means a narrower path or host-supplied piece exists. **Absent** means this SDK does not provide the target capability. The [standards map](/architecture/standards) records normative status; [quality and qualification](/operations/quality) explains the evidence tiers. Source links below identify code, not an independent conformance certification.

**Later source evidence, 18 November 2026:** A [redacted shared Ledger 9 receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/shared-ledger9-paidfix-deposit-20261118.json) records an independent sender resolving an existing `paidfix.night` claim to an activated ACC, reviewing the exact destination in its own browser, and finalizing one `deposit_shielded` transaction. The saved development mock-passkey owner reopened that same ACC and saw the exact 10-unit coin through the chain-verified holdings view. The sender source was signed `8165c73`; a separate signed `d5fc680` demo shutdown smoke proved orderly service drain and shared sponsor-lease release. This strengthens the local P2/P6 receive subset; the transitional registry, automated approval, mock credential, and single self-hosted provider remain the P2/P6/P8 limits described below.

The later source-preview resolver reads each requested name and its target ACC
at one indexer block. This removes a registry/ACC tip mismatch inside one
provider read. The local demo checks each supported-target lookup against a
separately pinned node's canonical finalized block, then compares the indexer's
registry and ACC state bytes with that node's response at the same block.
It refuses a mismatch, but still trusts the configured node and does not
establish a cryptographic state proof, an online provider, or the proposed
MIP-0007 delegated resolver.
With two configured indexers, the browser now requires a matching selected
finalized block and reads both providers at that exact block hash; a lagging
reader refuses. This guards the comparison's block scope but remains source
behavior without an independently qualified online mapping.
The configured known mapping pin and a different requested name are also
read within that same selected block per lookup.
The [matched-tip local receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/independent-indexer-matched-tip-20261122.json)
at signed source `3a860393` runs the configured resolver from Node against
the two self-hosted local indexers. It does not qualify a browser credential
or an online provider.

A later [single-provider mainnet read](https://github.com/input-output-hk/midnight-passport-sdk/blob/codex/midnames-ledger9-value-native/examples/midnames-online/evidence/mainnet-passport-name-v4-observation-20261122.json)
observed an existing `passport.night` record with a shielded primary target
through Midnames' Indexer API v4 endpoint. It does not establish Passport
control or delegation of that name, a contract-call ACC target, a second
provider, or node-verified state. Public `passport.night` issuance remains
unqualified.

A later [independent local indexer read](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/independent-indexer-local-provenance-20261122.json)
at signed `aa0d436d` used a second self-hosted Indexer API v4 instance with
separate storage and credentials. Both indexers returned identical serialized
registry and ACC state at the same canonical finalized claim block and the
same `paidfix.night` contract target through the configured two-provider
resolver. They shared one node. This demonstrates local provider
replaceability, not independent node consensus, authenticated contract-state
bytes, an online mapping, or full P2/P8 conformance.

The [Compact 0.36 read-only registry probe](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/compact036-readonly-20261119.json)
reproduced all 13 pinned circuit and key bytes and decoded an existing local
name at a node-finalized block. It does not qualify a 0.36 proof or submitted
claim, so the deployed 0.35 profile and its gas guard remain the demonstrated
write path.

A later [isolated 0.36.1 native receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/compact0361-native-name-control-20261123.json)
adds one paid, owner-proved `create_domain` original and one owner-authorized
`transfer_domain` original, each indexed `SUCCESS` with its raw bytes and
canonical block hash checked against the retained Ledger 9 node. The name
resolved to the same activated ACC before and after the owner commitment
changed. All 13 registry verifier keys matched the deployed roster, so this
did not replace a maintenance-retired verifier. The run used an isolated
chain, synthetic owner and sponsor, one self-hosted indexer, and the existing
deletion-credit guard. It advances the local P2/P8 name-and-provider subset;
P5 total-loss recovery remains unqualified. Online registry/provider,
independent inclusion proof, and real passkey custody also remain
unqualified. The ordinary shared
demo still pins its separate 0.35 registry profile.

The next [isolated Chromium check](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/compact0361-browser-owner-proof-20261123.json) proved a reviewed but unsent 0.36.1 claim
with a virtual PRF credential, then recovered the same owner commitment after
reload. It made no proof request before automated approval of the fixture
quote. The pinned browser
client and prepared artifact hashes are reproducible locally. A later
[connected Passport page claim](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/compact0361-page-claim-20261123.json)
used the isolated 0.36.1 registry, a virtual credential, an already activated
ACC opened through a fixture connector, and one self-hosted indexer. One
reviewed quote, owner proof, sponsor preparation and dispatch reached indexed
`SUCCESS`; the page recovered the original after a lost response and reload.
The node-canonical block and finalized owner and ACC target matched. This
qualifies that bounded local claim, not human-provider consent or combined
ACC creation and registration.

**Local recovery source preview, 20 November 2026:** The sponsor can now
recognize its exact quote in a bounded private archive, refuse a superseded
sibling quote with an owner-bound marker, and archive a dispatched original
only after its indexed failure is checked against a canonical finalized block.
The browser retains its original until that sponsor archive succeeds, then
checks the claim and registry again before offering a fresh quote. Unit and
headless Chromium tests pass. A separate isolated release-stack run with the
Compact 0.35 artifacts and a pinned Ledger 9 `1.0.2` reference client
finalized a fee-only claim failure, archived the exact sponsor original,
released the browser record after reload, and finalized a different claim
to the same ACC. A later signed `b58668e8` isolated run sent that fresh
prepared claim from the reference browser through the sponsor HTTP fence,
recovered its original after a lost response and browser restart, and verified
one indexed success to the same ACC. Quote issuance, owner proof, and sponsor balancing remained host-driven
in those earlier runs. A later signed local run at `46add31e` used
the actual Passport name form for one sponsor-issued pre-proof quote, owner proof,
reviewed send, indexed success and same-profile lost-response recovery. Its ACC
login was a fixture for an already activated account, and the failed original
used another browser profile. These checks do not establish an independent
provider, online naming, combined ACC create/open, or real passkey consent.
Signed `e3ec3608` later passed [one-profile release-to-retry](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/release-ledger9-page-same-profile-20261120.json):
the Passport page imported the exact indexed failed original, released it
through its archived sponsor journal, retained it after reload, and then sent
one freshly proved claim. Indexed success and the same ACC binding were
recovered after a lost response. The first original was prepared by the
isolated fixture, and the page used a virtual credential and an activated-ACC
login fixture.
Signed `4a6c7642` then passed a fresh [two-original page-owned claim run](https://github.com/input-output-hk/midnight-passport-sdk/blob/7c9acc2bf9b6a9a996ff7a95b0b40954376689c8/examples/midnames-local/evidence/release-ledger9-page-two-originals-20261120.json):
one persistent page profile obtained both quotes, proved and prepared both
originals, retained and archived the exact failed claim after its sponsor fee
succeeded, and recovered a distinct successful claim to the same ACC after a
lost response. The first send's HTTP result was unknown, but its indexed
claim-segment failure was verified before retry. This narrows the local P2
claim/retry gap; ACC create/open was still fixture-supplied at that head, and
real-provider, online, name recovery, and delegated MIP-0007 gates remain open.

**Later local source evidence, 22 November 2026:** A
[one-head receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/candidate-onehead-create-claim-pay-20261122.json)
records fresh ACC creation, paid name claim and named NIGHT payments in one
persistent synthetic-passkey browser profile on shared Ledger 9. The demo now
offers a random local `.night` suggestion after checking the same credential's
earlier selection; it still requires availability, quote, owner and payment
review. This advances local P2 onboarding but does not establish public
`passport.night`, real-provider consent, total-loss name continuity, an online
provider, or a released candidate ACC binding.

| Architecture surface | SDK status and evidence | Difference or limit against the target |
| --- | --- | --- |
| ACC custody and account lifecycle · C1, C4, P1 | **Implemented subset.** The pinned [`acc-s3r1.1` binding](https://github.com/input-output-hk/midnight-passport-sdk/blob/8117a10f9938093d21d656f8c504398957c58ac9/packages/contract/src/capabilities.generated.ts), [account flows](/guides/account-lifecycle), and [asset guide](/guides/assets) cover deployment, activation, reads, deposits, and supported withdrawals. | This is one binding and supported circuit set, not all future ACC versions. Deployment, credential access, proof, sponsorship, and settlement still require host ports. [Upstream reference limits](https://github.com/midnightntwrk/passport/blob/99062671d939641cb9ed9274d3d18fce764d539a/contract/README.md) are separate from this SDK's qualification. |
| Passkeys and signing · C5, C8, C9, P6 | **Implemented subset.** [WebAuthn adapter](https://github.com/input-output-hk/midnight-passport-sdk/tree/8117a10f9938093d21d656f8c504398957c58ac9/packages/adapter-webauthn/src), [key recipes](/architecture/keys-wallets), and account flows expose P-256 and PRF-derived JubJub paths. | Browser and authenticator support is profile-specific. The host owns consent and key lifetime; the SDK does not by itself enforce the architecture's complete owner-kernel isolation rule or qualify every provider. |
| Names and DID · C2, C3, P2 | **Partial / absent.** [`account/names`](https://github.com/input-output-hk/midnight-passport-sdk/blob/8117a10f9938093d21d656f8c504398957c58ac9/packages/account/src/names.ts) is a checked optional naming port. A pinned local Midnames reader, separate named-value fixtures, and an opt-in quote-bound post-ACC claim source preview exist. The [#342 native browser claim](https://github.com/input-output-hk/midnight-passport-sdk/pull/342) passed at signed `9a19757` with one dispatch, lost-response recovery and alternate-credential refusal. The independent deposit and two-leg NIGHT send passed at earlier signed `d492487`; all used isolated `undeployed`. A later signed `b87ed6c` sender-browser native deposit displayed the exact name, registry/provider, full ACC, asset and amount before automated approval; one dispatch finalized and the owner independently verified its held coin. Signed `ec83ce9` then qualified an automated owner-browser review before a synthetic signature for the two-leg named NIGHT payment: one withdrawal, an interrupted deposit, original-intent recovery, and 10/0 → 6/0 → 6/4 ACC balances. Online source configuration checks a known name-to-ACC pair through two paths but has no qualified live mapping. The source allows explicit archival of an exact full failure or a verified failed claim segment with only the sponsor DUST fee succeeding. At signed `c757388`, a fresh isolated `undeployed` run qualified the indexed paid claim-segment failure, explicit Chromium release, archived-original recovery after restart, and one distinct successful host-driven retry. The original and retry each dispatched once; inputs and exact-owned cleanup were verified. A separate signed `e456638` isolated run passed fixture-issued quote display and automated approval in owner Chromium before the naming PRF/proof, then one sponsored dispatch and lost-response recovery; source and owned-resource checks passed. The first functional attempt retained `FAIL` after Docker cleanup timed out and was reconciled before the fresh pass. A later signed local run at `46add31e` qualified one sponsor HTTP quote before owner proof, reviewed page send, indexed success and same-profile lost-response recovery for an already activated ACC on an isolated chain. Signed `e3ec3608` later qualified import, release and successful retry in one virtual-credential browser profile, with one quote, proof, preparation and dispatch on the retry and exact-owned cleanup. The first failed original was prepared outside that earlier profile. At signed `4a6c7642`, both originals were prepared and dispatched once in one persistent Passport page profile; exact failure archival and same-ACC retry success passed. That earlier fixture did not include account create/open. A later one-head local synthetic-passkey run combined creation, claim and named payment; human review and a real provider remain unqualified. A separate isolated Compact 0.36.1 run finalized both a paid name claim and a new-owner transfer to the same ACC under the matching 13-verifier roster; see the redacted receipt above. | The local `.night` registry and browser-scoped setup path do not supply supported public `passport.night` ownership, qualified real-provider create/open onboarding, online-provider qualification or authenticated chain-state provenance, name-owner recovery after credential loss, or DID creation/resolution. The automated sender and owner clicks and later mock-credential demo payment do not qualify human approval or real passkey consent. The known pair is an operator assertion, not proof of online qualification. The transitional registry's contract target is not the proposed MIP-0007 operation-context resolver. The demo mock remains distinct from the [architecture's name service](https://github.com/midnightntwrk/passport/blob/99062671d939641cb9ed9274d3d18fce764d539a/docs/plans/components/C2-name-service.md). See [0.2.0 work remaining](/architecture/milestone-0.2.0). |
| Peer devices and lost-device continuation · C13, P3–P4 | **Partial.** [Device operations](/guides/devices-grants) and [known-address opening](/guides/account-lifecycle) support enrolled credentials with complete live rosters and host-held records. A private locator and owner-authorised registry admission exist as a separate [source experiment](https://github.com/input-output-hk/midnight-passport-sdk/pull/327). | No automatic cross-device private-state sync or integrated unknown-account discovery in normal create/open. Individual entry removal must not be interpreted as retirement of every entry for the same key; the [reference architecture records erratum 8](https://github.com/midnightntwrk/passport/blob/99062671d939641cb9ed9274d3d18fce764d539a/docs/arc42.md#63-device-addition-and-removal). |
| Total-loss recovery · C14–C15, P5 and P5′ | **Absent from SDK.** The binding includes recovery circuits, but [account recovery limits](/guides/account-lifecycle) cover only a surviving or provider-restored credential. | No guardian/paper-key ceremony, recovery transport, veto-window client, or loss-of-all-credentials restoration. Upstream's [reference recovery path](https://github.com/midnightntwrk/passport/blob/99062671d939641cb9ed9274d3d18fce764d539a/docs/arc42.md#65-recovery-and-selective-disclosure) and its bounded proof evidence do not make it an SDK API. |
| Scoped grants · C10–C12, P7 | **Implemented subset.** [Issue, use, revoke, and reconcile](/guides/devices-grants) paths enforce supported recipient, asset, caps, expiry, and caller constraints in the pinned ACC binding. | No general read/write/execute grant language, interoperable grant-request ceremony, or arbitrary dApp operation. The [Passport scoped-grants text](https://github.com/midnightntwrk/passport/blob/99062671d939641cb9ed9274d3d18fce764d539a/docs/mps-mip/mips/mip-xxxx-scoped-grants.md) is still a Draft with placeholder number. |
| Private state and viewing · C16–C17, P3 and P8 | **Partial / host-supplied.** [Holdings and reader flows](/guides/assets), [optional secret store and journals](/guides/durability), and the demo's wallet worker cover selected local tasks. | No interoperable WPP package/storage/sync service or complete multi-device viewing-key distribution. A read grant and an on-chain revocation do not by themselves erase a disclosed viewing key. |
| Proof and fees · C6–C7, C24, P8 and P14 | **Partial.** [Service adapters](/operations/services) support delegated proving, sponsorship, and a separate funding service; [artifact guidance](/operations/artifacts) covers public keys. | Proving is trusted where witnesses are sent. The SDK does not promise private browser proving, universal zero-token onboarding, a Capacity Exchange fee route, or operation without a chosen operator. |
| dApp connection and intents · C22–C23, P7–P8 | **Partial.** [Account ports](/guides/hosts) let a host compose calls, and supported caller-bound grants can be used by an application contract. | No CAIP-25/EIP-6963 discovery, Sign-In-with-Passport, redirect authorizer, private-data handoff, or generic transaction joiner. A caller pin identifies the immediate contract, not browser origin or fee payer. |
| Credentials and cross-chain · C18–C21, C25, P9–P10 | **Absent.** The [architecture's component map](https://github.com/midnightntwrk/passport/blob/99062671d939641cb9ed9274d3d18fce764d539a/docs/plans/components/README.md#credentials-and-attribute-privacy) treats these as separate surfaces. | No credential issuance/selective-disclosure/nullifier APIs or cross-chain solver, bridge, or foreign-asset integration. An ACC proof is not a selective-disclosure credential proof. |
| Agent skills · C26 | **External/meta.** The SDK has documentation and reference recipes. | The architecture's agent-skills component is a project-level deliverable, not an account circuit or SDK runtime API. |

A later connected #318 Passport demo payment on the designated shared Ledger 9
stack finalized one 4-unit NIGHT withdrawal and one deposit to a claimed local
`.night` recipient ACC. The browser retained the original withdrawal through a
pre-dispatch deposit failure, then retained and reconciled both leg IDs against
indexed SUCCESS and canonical finalized blocks after reload. It used a funded
device wallet and local mock JubJub credential. It does not qualify real
provider consent, online naming, or an independent inclusion proof beyond the
configured indexer and node checks.

The later [isolated 0.36.1 routing-refusal evidence](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/compact0361-native-routing-refusals-20261123.json)
tests MIP-0007's address-class distinction for this local subset. A name with
the bytes of a supported ACC but an `UnshieldedAddr` target was refused before
owner review; the host did not treat it as a contract call. A separate live
change from one supported ACC target to another during review retired the
unsubmitted intent and required a new review before owner proof. The ACC
signature still binds the withdrawal to the bridge, while the name and final
recipient remain host-checked. This is not complete MIP-0007, online-provider,
or real-passkey conformance.

A [fresh isolated Ledger 9 comparison](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/ledger9-night-by-name-prover-comparison-20261122.json)
repeated the two-leg route on a release node and Indexer API v4. The release
`9.0.2` prover rejected the pinned Compact 0.35 JubJub withdrawal proof
before submission. The pinned `9.0.0-rc.8` compatibility prover on the same
release chain completed one browser-reviewed synthetic payment with exact
bridge-output consumption and 10/0 → 6/0 → 6/4 ACC balances. This is a
local compatibility profile, not release-prover or online conformance. The
first stable `9.0.0` prover also rejected that withdrawal. An
[offline ACC key probe](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/compact036-acc-withdrawal-key-probe-20261122.json)
found identical Compact 0.35/0.36 ZKIR for all 52 circuits but different,
repeatable JubJub withdrawal key bytes from the newer generator. The precise
HTTP 400 cause and a qualified replacement binding remain open. A
[native stable-prover probe](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/stable-withdrawal-036-key-probe-20261122.json)
then received nonempty proof bytes from `9.0.2` with the new withdrawal pair
for the exact synthetic browser-reviewed witness. It deliberately stopped
before transaction completion or submission, leaving balances 10/0 and the
old on-chain verifier unchanged. This narrows the artifact compatibility
boundary. A second signed run used one exact serialized withdrawal preimage:
the 0.35 keys returned HTTP 400, while the 0.36 pair returned nonempty proof
bytes. Neither run established a valid new ACC binding or release-prover
payment conformance. A later
[isolated hybrid diagnostic](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/stable-hybrid-night-send-20261122.json)
deployed the alternate withdrawal verifier on a fresh source ACC, then
completed one indexed withdrawal and exact-output recipient deposit with
release prover `9.0.2`: 10/0 → 6/0 → 6/4, one dispatch per leg. The source
retained the old runtime, ZKIR and 51 other old verifier keys, so this is an
unsupported diagnostic hybrid. An
[offline inventory](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/compact036-acc-key-inventory-20261122.json)
found 48 of 52 key pairs changed. A complete versioned 0.36 ACC binding and
its native, online and real-provider gates remain open.

A later [full-roster isolated run](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/stable-full-roster-night-send-20261122.json)
deployed all 52 alternate verifier keys on a fresh source ACC and completed
one stable-prover withdrawal and recipient deposit, with canonical indexed
balances 10/0 → 6/0 → 6/4. This is still diagnostic: the SDK registry,
restoration CLI and host routes serve the old binding, and the new source
retains the old module/runtime. [ADR 0020](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/adr/0020-ledger9-acc-key-generation-binding.md)
records the separate key-generation identity required before declaring a
supported binding or broader Passport value conformance.

The newer [isolated candidate-binding receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/candidate-acc-named-night-send-20261122.json)
pins a complete Compact 0.36 ACC module, ZKIR and all 52 key pairs. A local
root-owned `.night` record resolved to a candidate recipient ACC; a candidate
sender completed one stable-prover NIGHT withdrawal and exact-output ACC
deposit with 10/0 → 6/0 → 6/4 balances. Both on-chain verifier rosters,
retired authority, original leg journal and exact-owned cleanup passed. This
advances the local P2/P5/P8 subset, but the normal SDK/demo still refuse the
provisional binding. A later [connected candidate browser receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/candidate-connected-browser-night-send-20261122.json)
adds a fresh mock-passkey ACC, separate funded device wallet, reviewed name,
canonical withdrawal and deposit, retained-ID recovery, and 10/24 → 6/28
balances on the shared Ledger 9 stack. It spans signed heads and reuses an
earlier claim. A later
[one-head local browser receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/candidate-onehead-create-claim-pay-20261122.json)
adds a post-activation claim for a new ACC and a canonically finalized named
payment in one persistent synthetic-passkey profile. It needed one explicit
original-only finality check; a later separate payment completed automatically
after a page-level finality wait. Physical passkey custody, online provider
substitution and the wider recovery matrix remain open.

The signed `a20a9b9` isolated owner-browser refusal adds a narrow #318 negative
result: after Chromium displayed the exact named NIGHT route and clicked
**Decline**, both ACC balances remained 10/0, with no owner signature, payment
leg dispatch or admitted payment journal. The runner verified unchanged inputs,
exact-owned cleanup and lease release. Timeout or page close is an error rather
than evidence of an explicit decline. This does not establish human consent,
real passkey custody, an in-app send page or online/delegated name routing.

A separate signed `e8fd610` isolated #318 run updated the local root-owned
`alice.night` record on-chain after automated browser approval. Fresh
resolution returned a third activated ACC, while the original payment intent
kept its reviewed recipient. The send refused before any owner signature or
withdrawal/deposit dispatch, and all three ACC balances stayed 10/0/0. The
runner verified unchanged inputs, exact-owned cleanup and lease release.
This is a local repoint refusal, not online provider agreement, human consent
or the architecture's operation-context resolver.

A later [isolated post-withdrawal repoint recovery](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/compact0361-native-postwithdraw-repoint-recovery-20261123.json)
at signed source `a215ba3` finalized one browser-reviewed withdrawal before
the owner repointed the name to a second supported ACC. The connected browser
then separately reviewed and deposited the exact saved output into the
originally reviewed ACC, and a fresh browser found the archived review.
The supervisor's obsolete balance assertion failed after payment; exact
reconciliation confirmed both canonical originals, 8/6/0 → 7/7/0 balances,
no replay, and cleanup. This remains local synthetic evidence, with no
physical-passkey consent, online provider qualification, or ACC-signed name
binding.

The source now also offers a separate **direct original-output repair** when a
saved withdrawal is final but the current name is absent, invalid/non-contract,
expired, unsupported or unavailable. The user must review the unresolved
status and original ACC, and the host rechecks both before deposit. The browser
journal keeps the approval with the original withdrawal. Connected-host tests
exercise an unavailable name service. An [isolated non-contract name repair](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/compact0361-native-unresolved-name-original-repair-20261123.json)
also passed in a connected mock-passkey browser at signed source `9a8fb50`:
one canonical withdrawal, owner target-class change, explicit direct repair,
and one deposit to the original ACC. This does not qualify the other unresolved
statuses, a physical passkey, or an online name route.

## Security promises in the pinned architecture

The pinned [promises revision](https://github.com/midnightntwrk/passport/blob/99062671d939641cb9ed9274d3d18fce764d539a/docs/plans/PROMISES.md) specifies P5′ and P11–P16. These are product-level properties, not automatic effects of exposing an ACC circuit. The SDK's bounded status is:

| Promise | SDK/host evidence at this snapshot | Adoption gate |
| --- | --- | --- |
| P5′ · recovery authorisation | Recovery circuits are pinned, but the SDK has no total-loss ceremony. | [#240](https://github.com/input-output-hk/midnight-passport-sdk/issues/240): successor, veto/retirement, and independent review. |
| P11 · transaction safety | Selected owner and grant operations bind authority and scope; a host still controls approval and dispatch. | [#82](https://github.com/input-output-hk/midnight-passport-sdk/issues/82) plus [#242](https://github.com/input-output-hk/midnight-passport-sdk/issues/242) for all supported paths and external consent. |
| P12 · value integrity | Selected holdings/reconciliation and exact-value shielded withdrawal exist. | [#201](https://github.com/input-output-hk/midnight-passport-sdk/issues/201): private change, spent-coin and interrupted-settlement accounting. |
| P13 · funds availability | A self-hosted local path exists; operator, key and device loss are not all covered. | [#240](https://github.com/input-output-hk/midnight-passport-sdk/issues/240), [#241](https://github.com/input-output-hk/midnight-passport-sdk/issues/241), [#243](https://github.com/input-output-hk/midnight-passport-sdk/issues/243). |
| P14 · private proving | Delegated proving is available with disclosed witness visibility. | [#241](https://github.com/input-output-hk/midnight-passport-sdk/issues/241): current-ledger browser path or an explicit leakage budget. |
| P15 · guardian privacy | No guardian client or sharing ceremony is supplied. | [#240](https://github.com/input-output-hk/midnight-passport-sdk/issues/240): protected contacts and recovery transport. |
| P16 · upgrade safety | The SDK pins binding and artifact identity, with no general migration protocol. | [#82](https://github.com/input-output-hk/midnight-passport-sdk/issues/82) and [#244](https://github.com/input-output-hk/midnight-passport-sdk/issues/244): version and migration decisions before claiming upgrade continuity. |

The [component inventory](https://github.com/midnightntwrk/passport/blob/99062671d939641cb9ed9274d3d18fce764d539a/docs/plans/components/README.md) extends through C26. C25 is explicitly upstream-owned and post-initial-v1.0; C26 is a meta deliverable. A mapping row is not a claim that this SDK implements the service. The [P1–P10/C1–C26 adoption map](/architecture/adoption-gates) tracks SDK, host and external responsibility and testable gates for [issue #244](https://github.com/input-output-hk/midnight-passport-sdk/issues/244).

## Reading a deviation

Some differences are **scope choices**: this repository is a reusable SDK and reference demo, while the architecture also covers names, identity, guardians, and cross-chain services. Others are **integration gaps** against the v1.0 experience, such as total-loss recovery and dApp discovery. Neither kind should be silently described as conformant. For the separate upstream SDK design, see [upstream SDK comparison](/architecture/upstream-sdk).
