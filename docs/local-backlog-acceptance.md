# Local backlog acceptance audit

## Source-preview #236/#313 — 2026-11-10

The current local slice adds reusable closed-plan registry/image/Pages acceptance
and a fresh, leased mounted-image lane. See the
[review map](review/release-acceptance/README.md) and
[operator guide](../docs-site/operations/release-acceptance.md). Actual receipts
must name their signed runner, frozen inputs and distinct source/installed/native
scope. RC9 artifacts remain immutable; adding these commands does not publish a
new version, close GitHub issues or qualify provider/full Lace behavior.

## RC8 release reconciliation — 2026-11-09

RC8 packages/images are published and verified in the [signed receipt](release/rc8-publication-receipt.json).
All nine private packages share0.1.0-rc8/next; actual registry SHA/SRI,
18source/publisher attestations, fresh installed Node/browser/worker consumers,
software crypto and image/key HTTP checks passed. Final deployed-doc verification
is a separate signed release asset after Pages deployment. Native/provider/full
Lace evidence retains its original source/runtime boundaries.

The bounded UX/review follow-ups #287–#294 and #296/#297/#298/#300 are closed.
#299 remains open for wider valid-mounted service/funding runtime readiness;
#81/#232 actual host/provider, #201/#82 value/circuit coverage, #229/#240
revocation/total-loss, #230/#239/#269 durability/grant loss and #271 performance
remain documented limits. A preview release does not close these wider trackers.

### Historical preparation audit before RC8

The table below records the earlier preparation point at signedba33365, when RC7
was still the distribution baseline. It is retained as evidence of that review,
not a claim that current artifacts are unpublished or already fully qualified.
An open ticket alone does not prove missing implementation; implementation alone
also does not prove completed acceptance.

| Area / issues | Implemented and observed | Remaining acceptance / disposition |
| --- | --- | --- |
| Naming seam #288 | Portable name port/resolver, checked synthetic adapter and both-arm browser lookup; no recipient/credential side effects | Ready for supported mock-seam acceptance; production naming remains #247. |
| Presentation #289/#290 | Portable interaction snapshots, optional host controls, responsive Activity/navigation, keyboard and in-flight operation isolation | Ready for supported synthetic UX acceptance. Later owner decisions moved progress to Activity and removed Overview; do not restore earlier layouts merely to satisfy stale wording. |
| Settings/Audit #291 | Nested page links, explicit developer settings, separate account/wallet/sponsor, redacted Audit and unknown-result guards | Ready for current approved layout acceptance. Earlier Overview/collapsible-panel requirements are superseded by the owner's landing/submenu decisions. |
| Optional React/Lace Wallet #292/#293 | Source-only optional React example, independent cleanup/remount, public read-only wallet connector contract and synthetic refusals | No React dependency in neutral packages; actual extension/provider, React Native and lace-sdk remain explicitly unqualified. |
| Browser handover #294/#245/#246 | Merged combined login, fresh critical consent, lease/route fences, independent bounded grants and library/demo guides. Clean `ba33365`: 192 both-arm synthetic cases, 2,467 tests, seven existing skips and independent review | Real providers and prompt budgets remain #232; current-source code is not installed by RC7. Hosted CI and publication for the new correction remain distinct. |
| Review follow-ups #296/#297/#298 | Lease-captured RP scope, canonical authorisation plus identical preview alias, ten-minute routine/full-owner default and concise single-dialog copied-key warning | Implemented/tested at `ba33365`; final release install/export and deployed documentation acceptance still required. |
| Runtime images #299/#234 | Both actual Linux/amd64 candidate images pass content/non-root/startup-refusal smoke and injected-private-path rejection | Does not establish native functional readiness or registry image publication. Keep operational criteria open for the release head. |
| Durable owner mutations #230 | Four-intent coordinator, typed journal/outcome/consent ports, original-ID fences and source/native lifecycle observations exist | Default demo buttons do not automatically use this coordinator. Complete the explicit supported interruption matrix; no universal crash window or value-call coverage claim. |
| Durable jobs #233 | Serialized descriptors, accepted-before-ack/CAS claim, explicit original-record reconcile, bounded events/retention and Node HTTP/file/process tests; opt-in reference wiring | Arbitrary callback jobs remain process-local. Missing original host state stays unknown; no replay scanner, distributed-wallet lock or storage rollback guarantee. |
| Grant loss #239 | Original-issuing-reader reconstruction against live complete commitments; wrong-reader/missing-opening refusals; grant/revocation controls and documentation | Another enrolled reader is not automatically the issuing reader. Incomplete publication requires original protected intent; no total-loss or private grantee-key reconstruction. |
| Actual package adoption #81/#263 | Nine fresh tarballs installed frozen/offline at `ba33365`; 34 runtime exports, strict Node/DOM/Worker and maintained docs compile, no workspace SDK alias | This is a local candidate consumer. Current pinned Lace full-module/hosted runtime, registry provenance and actual provider flows require separate acceptance. |
| Distribution #236/#31 | Existing signed-tag package/image/docs workflows and RC7 publication receipts | New packages/images/Pages must be built and checked at the chosen release head; no new release is implied by this reconciliation. |

### Recorded current-source evidence

At clean `ba33365`: full required gate 2,467 passed/seven existing skips;
independent exact-head review found no actionable defects; 192 synthetic browser
cases passed in 163.726 seconds with owned browser/server/cache closed. Installed
candidate `0.0.0-dev.source.gba33365b5996` manifest SHA-256 is
`d1fdc88038890967199210bbc055975babd48b00935b2e991665b738a87209d4`;
nine archives and all 34 public runtime exports were checked. This is not registry
provenance. Source-native final `e100762` qualified 28 lifecycle observations;
that run keeps its original source and is not relabelled as this correction.

### Supported-preview exit criteria

Settle the public subpath before publishing; keep original mutation/job/grant
identities and exact-value shielded guards; qualify final-head package installs,
image/runtime/content and published docs; retain exact evidence and known
unsupported paths. Measure hosted CI against the 30–45-second warm target without
omitting cells or acceptance. Real-provider/full-Lace gaps must stay visible rather
than becoming broad compatibility claims. Broader features remain #201/#82/#240.

Do not blanket-close historical trackers from this table. Close a bounded issue
only after its exact supported criteria and required review/delivery are reconciled;
keep genuinely unmet host/provider/release criteria in the existing issues. No new
implementation ticket is needed for a feature merely because its old box is unchecked.


Candidate: nine `0.1.0-dev.12` packages; local only. Date: 2026-10-17.
This audit covers issues #25, #205, #79, #161 and #81. It does not authorise a push or release.

| Issue / requirement | Evidence | Status |
| --- | --- | --- |
| #25 actual browser WebAuthn/PRF path | `apps/passport-dapp/e2e/virtual-authenticator.e2e.ts`: CDP CTAP2 resident credential, user verification and PRF. Full localnet run created ACC `3ae05ff57a8ad4fd76a9e8e3cef3041200882c1b06d6d058c4f4a3cc5c26469a`, rotated, reloaded/reopened, refused an unrelated wallet credential, connected the pinned wallet and rotated again; 19 assertions. The test checks creation event-log stages and ceremony counts. | Passed locally. |
| #25 negatives and limits | Same one-command test defaults to no-PRF refusal before deployment and cancellation; full chain path is opt-in. `AGENTS.md`, `apps/README.md` and `docs/prototype/` document invocation and real-provider limits. | Passed; synthetic authenticator does not establish Google/iCloud behavior. |
| #205 build cache exclusion | All nine package file lists exclude `dist/.tsbuildinfo`; release pack inspection rejects caches. | Implemented and checked. |
| #205 independent reproducibility | `scripts/check-release-reproducibility.mjs` installs/builds/packs in two distinct clean paths; all nine dev.12 SHA-256 hashes match. `.github/workflows/publish.yml` runs it before provenance attestation. | Passed locally; publisher verification remains a release gate, not a claim of a new publication. |
| #79 key derivation and secret boundary | PRF/JubJub, suite-2 interop and device-keyring tests; typed `AccountViewingKey` ports. Account flows receive public keys, opened data and ciphertexts, not viewing/reader secrets. Local key-origin implementations zero temporary secret copies. | Implemented and tested. |
| #79 both cross-product directions | `experiments/lace-consumer/results/2026-10-17-cross-signin.json`, `2026-10-17-hosted-authorising-device.json` and `2026-10-17-lace-created-sdk-open.json`: SDK ACC recognised by unmodified Lace hosted sign-in; native Lace hosted-created ACC opened by SDK address recovery with local key-origin ports. Same network and binding. | Passed in synthetic-credential protocol tests. |
| #79 recovery limits | `docs/site/keys.md`, `docs/prototype/keys.md`, consumer report: surviving enrolled devices can open their envelopes; ACC address does not recreate a lost passkey. | Documented; localnet P-256 and mixed-device evidence recorded. |
| #161 versioned registration | ADR 0009 and key tests: authenticated `0xd5` P-256 policy registration, canonical compressed SEC1 encoding, suite/size/padding/downgrade checks, legacy JubJub support. | Implemented and tested. |
| #161 P-256 and mixed recovery/rotation | `sdk-p256-sealed-device-node.json` and `sdk-mixed-device-recovery-node.json`: live membership, sealed openings, surviving device recovery, removal/refusal and mixed-roster rotation. Deterministic-key legacy accounts explicitly refused. | Passed locally. |
| #161 read-grant issue and preservation | `sdk-p256-read-grant-enroll-node.json`: issue read grant, open seal, rotate during enrollment, open new seal, refuse old seal against new key and open from joining device. Unit tests cover incomplete roster/opening refusals and revoke/revoke-all. | Passed, including the additional live read-grant revocation below. |
| #161 read-grant revocation on localnet | `sdk-p256-read-grant-revoke-node.json` records the issue/enrollment flow followed by rotation/revoke, inactive live grant, old seal refusal and both surviving device openings. ACC `072b07567c9ab7eb57ca536249ec5b789f65e05485de5d8a45be88e0e761a75d`; revoke transaction `668371a715dd7c20f2f10988fad053507841710fa2012a818f218a2558de5e1c`. | Passed locally. |
| #81 exact source types and package installation | `smoke-lace-source-consumer.mjs` pins merged Lace `502b0794cc7bcfc76342230193fef4ebb63cae1c`; dev.12 types pass with seven direct Midnight versions matched. `smoke-release-tarballs.mjs` passes nine entrypoints, types, browser build, physical runtime identities and manifest-verified prover restoration. | Passed locally. |
| #81 runtime flow and report | Native Lace hosted creation, hosted sign-in and SDK authorising-only device addition have confirmed localnet results in the consumer report. The device test checks live commitment, two devices, nonce and subsequent healed sign-in. | Passed for those exact flows; no full compatibility claim. |
| Signed local delivery | GPG signatures, DCO sign-offs and `Assisted-by: AI` trailers on commits; full repository gate before each commit. | Preserved; no push/PR/publication. |

## Next preview consent/demo slice — 2026-11-05

#279 (synthetic Playwright journeys), #280 (capability/demo/docs map) and bounded
#246 corrections are in milestone 0.1.0; #282 owns final actual release verification.
The new tests must not close #232 provider acceptance or #245 broader concurrent
session isolation/prompt budgets. Local expiring JubJub delegation is separate
#281 / 0.2.0 and not implemented. PR278 is merged as `7a077d9`; its native receipts
retain their original executed source. Current publication stays RC6 until the
next signed artifact and registry/image/Pages receipts exist.


## Intentional integration limits

The generic SDK create flow needs validation requests excluded from Lace's creation scope;
non-rotating sealed enrollment needs roster reads excluded from its scope; hosted sign-in hides
device registrations needed by SDK address recovery. Lace retains its flow orchestration. The
working reverse test uses native Lace hosted creation and SDK recovery with local key-origin
ports. An authorising-only device entry does not deliver a viewing secret. These distinctions
are recorded in [the consumer report](lace-consumer-report.md) and ADR 0010.

The circuit HTTP prover and transaction prover are different interfaces. The direct localnet
sponsor in the native Lace test is diagnostic infrastructure; no service sponsorship policy was
relaxed. The exact-value shielded-spend guard remains in place. Browser chunk warnings and a
successful Vite build do not establish every SDK flow in a deployed browser signer page.

## Outcome

All five issues meet their local acceptance requirements for the exact supported paths above.
The goal does not include publication or a claim of full Lace compatibility. The documented
hosted scope limits remain integration boundaries, with passing evidence obtained through
Lace-owned orchestration and the supported SDK ports. No push or PR was created.
