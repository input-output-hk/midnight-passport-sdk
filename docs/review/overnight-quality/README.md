# Overnight SDK quality and UX execution — 2026-11-08

## Working agreement

Owner-authorized local session, started2026-11-07T22:59:21Z (23:59CET),
with an8–10hour working window ending07:59–09:59CET on2026-11-08.
Continue on `codex/rc5-publication-record`, baseline signed
`0d5ec73f707ad13c80ba26169bda9cb0c6c25ffc`. No pushes, PRs or publishing tonight.
Use focused sub-agent implementation/reviews with explicit file ownership,
full Nix gates before GPG/DCO/Assisted-by commits, exact-head independent review,
and meaningful browser/consumer evidence. Preserve user demo/state/unknown IDs,
existing native resources, all prior immutable receipts and package APIs where
possible. Public docs live here; running checklist/evidence live in Obsidian.

## Latest accepted local state

Signed implementation `04aabc4` and fixture-only follow-up `44af4ac` complete wave10.
Both exact clean-head reviews found no actionable findings. Full Nix gates pass
2,294tests/sevenexisting skips; clean all-package coverage is95.25/94.00/87.32%.
Fresh nine local tarballs from04a pass33actual exports, strict Node/DOM/Worker/docs
and six software/generated-contract crypto cases with unchanged inputs. The final
44af docs render44pages/2,086local targets and pass1280/390layout checks. Real
browser worker/IndexedDB checks pass at44af; last full192synthetic journeys areW9.
These evidence tiers and source revisions remain separate. No publication tonight.

Wave11 in progress: semantic browser/CI groups, recursive consumer-tool quality
inventory, browser teardown result observation and current/historical agent-docs
separation. Its final gates, signed head and current-source browser acceptance are
pending. The [local stack plan](stack.md) proposes coherent review units for tomorrow.
Current checkpoint and immutable packets remain in the owner's Obsidian milestone
space; original failed attempts and unknown-state evidence are preserved.

## Acceptance and execution backlog

| ID | Deliverable | Required observable outcome | Status |
| --- | --- | --- | --- |
| O1 | Consent consolidation | One app review before each actual credential request; retain exact transaction/device/grant approval and create maintenance acknowledgement; cancel invokes no credential; retries are fresh; no stale-lease fallback | Delivered in waves 1 and 3; exact owner inputs join the actual ceremony review |
| O2 | Entry navigation | No Overview menu item. Signed-out entry offers Sign up/Log in; authenticated home navigation opens Account balances without another credential, account reset or lost draft | Delivered and browser checked in wave 1 |
| O3 | SDK boundary defects | Grant-holder review/sign/send use one immutable admitted input; bounded decimals before BigInt; Node Buffer session reads do not erase retained keys | Fixed, including immutable grant records/openings in wave 2 |
| O4 | Reusable API and domain readability | Extract cohesive responsibilities from measured large files, clear capability/custody/authority naming, no API/recipe churn or inflated quality ceilings | Typed rotation/enrollment/job phases in waves 2–4; keyring modules in wave 5; selective/all P-256 grant revocation in wave 7 |
| O5 | Input and platform contracts | Zod/branded admission where needed; safe malformed/oversized/mutating input handling; browser/Node import/type behavior preserved | Waves 1–7: bounded config/jobs, owned key/coin inputs, invocation IDs, cleanup and total V1/raw-mutation observation lifetimes |
| O6 | Browser coverage | Playwright journeys cover successful/cancel/retry/expiry/navigation flows and exact request counts; actual DOM/worker/storage tests distinguish synthetic account/chain from native evidence | 192 both-arm journeys pass at the clean signed wave9 head; worker/storage checks pass at wave10; final overnight rerun follows the last runtime tranche |
| O7 | Promptless upstream behavior | Pin current staging/public source; explain persisted-key restoration vs fresh authentication. Any implemented resume never infers private authority from machine trust or public hints | Research published locally; no implicit private persistence |
| O8 | Human copy and docs | Remove redundant reassurance, keep meaningful action/scope/recovery information, align API examples, agent guide and architecture decisions | Library/demo paths and rendered/typechecked examples delivered; contract guides in wave 2 |
| O9 | Independent handover | Sub-agent reviews plus independent exact-head review, signed local commits, passing gates/coverage/consumer checks, signed immutable packet and updated checkpoint | Waves 1–10 signed and independently accepted; wave3 finding closed in wave4; final overnight review remains |

## First tranche verification

The first frozen candidate passed the full Nix gate: **1,551 passed / 7 existing
skips**, lint, format, package build and all three app type checks. **190 both-arm
Chromium journeys passed**, with stable runtime input hash and all owned resources
closed. The initial browser candidates exposed a Home transition timing defect
(fixed), a removed-menu expectation and two expiry-fixture timing/serialization
errors (corrected without weakening the lease guard). Failed receipts are retained.

All nine package80% coverage floors pass at **93.63 / 92.43 / 85.00%**
lines/functions/branches. Pinned Jekyll4.4.1 renders41pages;1,758local links/assets/
anchors pass. The new library example type-checks; owned desktop/mobile docs checks
pass. These are local source/virtual-browser results, not provider/native/released
acceptance. Signed head `80bf7e096a60abaffa52052ab7009b8793a66588` passed independent exact-head read-only Codex review with no actionable findings. Its signed immutable evidence packet retains all early failures; the original 1,542 indexed artifacts are unchanged.

O1's duplicate generic modal, O2, O3 and the first O5 boundary fix are implemented.
O7 research is documented; automatic private-session persistence is not adopted.
O8 now has explicit Library integration and Reference demo entry paths. Remaining
O4/O5/O6/O8 work continues in the following local tranches, including exact-intent
consent consolidation, operation decomposition and adapter deadlines/startup.

## Findings already confirmed

- The public independent grant-holder helper retained caller-owned intent across
  awaits. An input could change between initial validation and review while the
  submitted amount still used the earlier value. Snapshot and validate before
  entering the key session; all later stages must use that same snapshot.
- The session authoriser returned `secret.slice()`. For Node Buffer this aliased
  the retained secret, so downstream cleanup could erase it during construction.
  Return owned base-Uint8Array copies and test repeated use/disposal.
- Grant decimal parsing accepted unbounded text before `BigInt`. Bound decimal
  length and range without silently coercing values or changing grant authority.
- Generic operation review and actual ceremony review opened two consecutive app
  dialogs. Stage context, then review the actual ceremony with operation details.
  Do not issue a blanket consent token or discard exact transaction consent.
- Overview was a login landing presented as a normal workspace. Remove the menu
  entry and preserve authenticated account state on home navigation.

## Authentication research decision

Upstream staging restores a persisted wallet seed using AES-GCM ciphertext and a
usable nonextractable decrypt key stored in the same IndexedDB origin. The current
record has no enforced expiry. This is a demo persistence choice, not proof that
an arbitrary trusted machine supplies user authentication. Current upstream
custody actions separately obtain a fresh assertion and discard the signer after
each action. See the dated research promoted alongside this review map.

Default policy stays explicit: passkey login and critical approvals, bounded
routine reader/wallet reuse, and JubJub transfers only inside an approved scope.
A public remembered account can be shown as locked; it must never substitute for
credential possession, sealed-reader verification or live on-chain authority.
Persistent secret custody requires explicit host selection and consent; no owner
key or wallet seed is silently persisted by this tranche.

## Evidence contract

Record base/head, dirty candidate status, input/runtime hashes, command results,
mock/native boundaries, failures/skips and owned cleanup. All nine executable
package coverage floors remain80% lines/functions/branches. No test count alone
proves provider UX, native proofs, recovery from lost credentials or full Lace.
No exact-value shielded guard removal, implicit owner enrollment, mutation replay,
new automatic key persistence or real user passkey/account/fund operation.


## Second tranche: typed transitions and bounded adapters

The JubJub viewing-key transition now has explicit internal phase records and
modules: plan and authenticate the complete roster, prepare fresh material,
publish then recheck, switch/observe the key, and finish the requested authority
change. Enrollment, removal and read-grant revocation keep their existing flow,
key session, IDs, challenge bytes and ordering. Publication and observed key
switch precede the final authority change. Duplicate inbox entries remain a
multiset check; a set must not hide duplicates. The connector's measured maximum
complexity falls95→19, maximum function span1563→938 and file1727→1083lines;
new helpers stay below default600line/150function/25complexity limits. Quality
ceilings ratchet down, not up. The remaining large factories are still debt.

Checked service-config discovery uses a 30s default deadline across both headers
and body; explicit timeout1–600000ms and native-stream64KiB bounds refuse before
adopting config. Invalid budgets refuse before fetch. Legacy three-argument
`fetchServiceConfig` retains its no-deadline plain-GET behavior. Network-first
pin checks and versioned extension fields preserve their established behavior.
A custom transport that only exposes `json()` owns its allocation limit and may
ignore cancellation; bounded waiting does not forcibly stop such external work.
The browser background adapter starts native MessagePorts after attaching owned
listeners and cleans up partially failed initialization. Real MessageChannel RPC
is tested with no caller `start()`; Worker behavior remains separate.

Grant opening/record max values are bounded decimal uint128 inputs before key
work/commitment helpers. Sealing captures record plaintext before any await;
opening copies its192byte envelope, including Node Buffer, before asynchronous
checks. Caller mutation cannot silently change the authenticated record. Existing
suite1 reads and suite2 wire/crypto recipes remain unchanged. Failed original IDs
and scope/unknown fences are preserved. No secret is newly persisted.

Wave2 frozen integration passes the full Nix gate: **1,598 tests passed / seven
existing skips**, lint/format/build and all app typechecks. **192 both-arm synthetic
Chromium journeys pass** with stable runtime hash and owned resources closed;
this includes changing the grant-recipient form during the live roster await and
checking review and submission retain the originally admitted recipient. All nine
80% coverage floors pass at **93.93 / 92.70 / 85.31%** line/function/branch. Actual
native MessageChannel RPC, owned HTTP success/header-stall/body-stall and browser
worker/storage tests pass. These remain synthetic account/chain tests, not native
transaction or real-provider acceptance.

Seven exact documentation snippets strict-typecheck across neutral ES2022, browser,
WebWorker and Node transport configurations. Pinned Jekyll4.4.1 renders43pages;
1,933local targets/anchors pass. Desktop/mobile entry/reference navigation and new
guides have no page overflow, with owned browser/server cleanup. Library contracts
and demo defaults are separate; published RC7 remains unchanged. The signed head
and independent exact-head review will be recorded after the final precommit gate.

The independent asynchronous-contract audit confirmed the next local slice:
neutral background initialization/send-failure cleanup and pinned checker/scheme/
byte-admission hardening. Current docs state the existing transport limitations;
passing built-in browser tests do not qualify every custom port. Typed P-256
enrollment decomposition and exact-intent consent consolidation follow separately.

## Third tranche: exact review, P-256 phases and consumer boundaries

P-256 enrollment now uses typed plan/execution records with the original reader
snapshot, nested rotation Flow, challenge/nonce and acknowledgement semantics.
The connector falls1696→1362lines and1585→1252maximum function span; complexity
47→45 and non-null assertions47→27. New modules use default budgets. The remaining
P-256 viewing-key rotation factory and service job orchestration are next debt.

Neutral background initialization/send failures release owned resources even when
a custom port fails partway through setup. Authorization pins its original
checker/receiver/scheme and copies admitted native bytes without invoking caller
iterators or trusting shadowed byte lengths. Delayed old credential work cannot
resume after its owned scope ends. Selection/binding changes refuse without
switching accounts or implicitly prompting again.

P-256 browser unshielded withdrawals preserve the core key-session boundary but
skip unused eager PRF work; actual-crypto software-authenticator tests show one
fresh strict sign call and no PRF extension on the normal path. Other operations
and public PRF sessions retain their established behavior. Strict-profile retries
have fresh decisions. No broader live-provider/native prompt claim is inferred.

The demo stages frozen owner withdrawal/export inputs and reviews them in the
first actual derive/sign dialog. Account, actual signer, route, amount/asset/recipient
or grant ID are rechecked before the exact POST/display. The facade and primary
account are distinct objects and are deliberately captured separately. Matching
scoped-grant transfers retain a standalone exact decision because they invoke no
new credential call. The independent exact-review audit found no actionable issue
under the stated trusted-host composition. It is user-decision state, not a
cryptographic one-shot capability; custom hosts still own guarded effect ports.

The frozen candidate passes **1,692 tests / seven existing skips**, full Nix lint,
format/build and all app typechecks. All-nine80% floors pass at **94.22 /92.93 /
85.64%** lines/functions/branches. **192 both-arm browser journeys pass**, with
stable runtime hashes and all owned resources closed. An initial audit-copy test
incorrectly required a raw completed attempt for a cancelled review; the corrected
test checks semantic cancellation and retains the honestly failed raw attempt.
Both original failure and passing rerun are preserved.

An offline copied-dist consumer resolves all nine packages/33public subpaths and
strict-checks neutral Node, DOM and WebWorker examples with zero diagnostics. All
SDK bytes resolve within the external copied graph;79physical external dependencies
are fingerprinted/reused, not installed. It is source-preview evidence, not package
installation or registry/release qualification. Source/runtime hashes are unchanged
across the successful run. Jekyll renders43pages with1935local targets valid, and
desktop/mobile entry/library/demo/contract navigation has no horizontal overflow.
Library contracts, host responsibility and demo defaults have separate guides.

Next concrete audit findings: service job capacity can exceed its default serial
queue, response bytes are not bounded, discarded error streams are not cancelled,
and async observer rejection can escape. Fix those before calling this adapter
robust under outage/load. Native populated lifecycle qualification remains blocked
by retained hard-coded stack bindings; this run will not interrupt another stack.

## Fourth tranche: readable jobs, stable leases and checked onboarding

The independent review of signed `5971cf1` found one P2 in authorization: replacing
a lease with another instance sharing its prototype checker could validate the old
receiver. The local follow-up requires the same lease object. Regression tests
first reproduced both pre-callback and post-private-read failures on the previous
compiled source, then passed with the fix. A dispatched mutation still returns
its original receipt after replacement. The guide now requires stable lease
identity instead of manufacturing a wrapper on every lookup. Wave 3's immutable
packet retains the finding; it is not labeled an accepted final handover.

P-256 viewing-key rotation now has typed planning, material, publication/switch and
completion phases. The entry falls from 523 lines / 506-line factory / complexity
70 to 55 / 34 / 1. All new phase functions fit default budgets (maximum 68 lines,
complexity 15), with no new unsafe assertions. Existing nested Flow, original owner
session, exact nonce reads, duplicate inbox counts, grant exclusions, callback
order and unknown receipts remain covered. The final grant-source lookup still
happens inside its Flow callback, preserving host observer replacement behavior.

Host jobs now separate identity/validation, public decoding, transport lifetime,
observation and service scheduling into small typed modules. All three superseded
legacy exceptions are removed. The service-owned queue honors validated active
capacity; custom queue failures remain conservative unknowns. New deployment
admission checks arm/scheme coherence without rewriting historical records. Native
reply bytes are bounded using the actual maximum compact snapshot, discarded/late
streams are cancelled, and async observers settle within the invocation budget.
No automatic POST replay, replacement ID, lost-history repair or authority widening
is introduced. Focused service/job tests pass 66 cases; P-256 rotation and existing
related flow contracts pass 83.

Developer onboarding now corrects stale navigation, address opening, grant UI,
worker location, storage and historical key guidance. The package/runtime matrix
distinguishes portable APIs, browser capabilities, Node service requirements and
import safety. Optional account methods have explicit port/capability guards.
Library examples take host ports and lifecycle callbacks; demo guides explain the
reference application's choices separately. No declaration generator is claimed.

Every TypeScript fence in the current site and both example modules enters a
checked inventory. The source compiler runs in required lint, with no hidden
placeholders or snippet execution. The current inventory has 27 complete examples,
33 target instantiations across neutral ES2022, DOM, WebWorker and Node, and zero
fragment exemptions. Documentation diagnostics preserve Markdown source lines and
JSON receipts include snippet hashes. Node source compilation also exposed private
DOM-global `CryptoKey` annotations; these now derive their type from the runtime's
WebCrypto API without introducing a Node dependency or changing crypto recipes.

Full integration, coverage, rendered docs and independent follow-up review are
recorded after their frozen-candidate checks finish. Published RC7 and deployed
Pages remain unchanged; all work is local. Native isolation planning is separate
and does not establish proof acceptance.

Wave 4's final full Nix gate passes **1,755 tests / seven existing skips**, including
required documentation checks, all builds and all app typechecks. All-nine coverage
floors pass at **94.55 / 93.08 / 85.89%** lines/functions/branches. That coverage
candidate predates three checker-only regressions; package runtime is identical.
The docs checker has eleven focused regression tests. Independent checker review reproduced
stale-dist fallback, nested inventory gaps and ambient placeholder contamination;
the follow-up requires actual source files, recursively accounts for examples,
checks public import paths and rejects ambient host declarations/suppressions.
The API and worker examples now take host capabilities as explicit parameters.

Rendered docs have 43 pages and 1,957 valid local targets. Expanded desktop/mobile
inspection caught a long hash escaping the mobile content width; `overflow-wrap`
fixes it while code/table scroll regions remain usable. Failed and passing visual
receipts are retained. Final hashes/render and independent signed-head review follow.
No new browser/native/provider or released-artifact acceptance is inferred.

The checker re-review additionally reproduced Node ambient injection through a
triple-slash reference and private CommonJS `require` imports. Authored reference
directives and require/import-equals shortcuts now refuse under the public ESM
example contract. The original probes and re-review results remain preserved.

Final bounded checker re-review accepts all original and follow-up controls;
eleven focused regressions and the final full gate pass. Reference/type directives
cannot add ambient Node capabilities to a neutral example, and CommonJS shortcuts
cannot bypass public ESM imports. Earlier failed probes remain immutable evidence.

## Fifth tranche: key input ownership and fresh native isolation

The keyring captures its input collections, recipient/device/policy values and
rotation destination before asynchronous PRF access. A pending provider request
can no longer let a mutable caller redirect delivery or extend the admitted inbox
past its 4,096-entry limit. Exact wire entries are copied; malformed entries remain
bounded non-opening noise. Caller buffers are not zeroed by alias. Small typed
admission/material helpers replace the large keyring factory and remove its legacy
function/non-null budget exceptions. Wire suites, domains and public signatures remain.

The encrypted mutation journal now serializes one admitted document and uses the
same revision for encryption AAD and the byte-store CAS. This prevents an acknowledged
but unreadable record when a caller changes its revision during key derivation.
Grant-view admission rejects oversized wire bytes before copying. Independent review
also found shadowable expected-key length and twice-read policy fields; the follow-up
uses intrinsic byte sizes and copies the same captured fields it validates. Tests
cover real encrypted records, Buffer ownership, changing getters and pre-copy refusal.
These are synchronous/async input controls, not a sandbox for malicious host code.

The native runner gains a closed fresh source-lifecycle profile rather than adopting
the archived legacy stack. Parent and three worker entries agree on a bounded private
descriptor, run ID, canonical paths, exact endpoints and owner-fixture scope. Partial
markers/overrides refuse before setup. Exact newly recorded container/image/volume/
network identities govern control; a shared wallet lease prevents concurrent lanes.
Source/dist, physical dependency, reference and key hashes are frozen and rechecked.
Deadline/abort checks guard later worker/container effects; cleanup waits for owned
children, stops only owned compute and preserves volumes, unknowns and failure roots.
Uncertain creation or incomplete cleanup retains the lease. Offline fake-stack tests
are not native proof acceptance; live receipts remain a separate measured result.

The outer qualification runner now forwards parent SIGINT/SIGTERM to its detached
owned scenario, permits the isolated lane's explicit cleanup grace and cancels delayed
escalation on child close. Full-suite regression checks an interrupted receipt's
closed schema and deferred scenario inventory, not just a child exit. Interrupted
cleanup cannot turn the run into a pass or start the next scenario.

Library documentation now separates private account keys/recovery from public
proving artifacts. Agent and demo troubleshooting no longer recommend deleting
credentials/state or replacing uncertain sends after a timeout. The library guide
owns contracts; the demo guide owns its consent/lifetime/worker choices. Source
compilation, rendered navigation/links and desktop/mobile checks follow the same
documented gates. All changes stay local; published packages, images and Pages are
unchanged. Final full-gate, coverage and independent exact-head evidence follow.


Wave 5's initial full gate passes **1,821 tests / seven existing skips** and
all app typechecks. Package runtime coverage passes all nine 80% floors at
**94.58 / 93.17 / 85.88%** lines/functions/branches. The initial render has 44 pages
and 2,050 valid local targets; owned desktop 1280/mobile 390 Chromium checks pass,
including keyboard navigation and no page overflow. A later heading/readability
pass needs its final rerender rather than inheriting the earlier count.

Independent keys review accepts the two admission follow-ups, verifies caller
Buffer ownership and unchanged wire source files, and retains actual/reconstructed
probe provenance separately. Independent native-control review found two additional
pre-run gaps: binary `.bzkir` inputs were absent from the frozen artifact inventory,
and an async private-log write rejection could escape the worker completion promise
and bypass normal supervisor cleanup. Both must be corrected and reviewed before
any native attempt; the passing initial gate does not close those findings.


The isolated-runner follow-up closes both P2s. Initial and final verification now
use one frozen inventory of **208 artifacts across 52 circuits**, including binary
ZKIR. Worker completion observes early spawn, synchronous callback and asynchronous
private-log failures while preserving the original rejected promise. Seven new
focused regressions pass, independently rerun; the full follow-up Nix gate passes
**1,828 tests / seven existing skips**. Package runtime is unchanged from the
reported coverage candidate. No native proof has started at this checkpoint.

Rendered-link checking is now reproducible in the repo and runs after Jekyll,
before Pages upload. Nine Python fixture tests cover base URLs, entities/Unicode,
relative links, assets/anchors, path/symlink escapes, duplicate IDs, bounded HTML,
empty renders, exclusive receipts and unsupported base-href directives. Independent
review reproduced a false pass when an HTML `<base href>` changed browser resolution;
the follow-up refuses such directives instead of guessing. Original failed probes
are retained. Pinned actionlint passes. This small Pages-only check leaves fast PR
runtime checks unchanged; external links, CSS, browser layout and deployment remain
separate evidence.

A fresh copied-output consumer passes for all nine packages and 33 public subpaths
in strict neutral/Node, DOM and WebWorker contexts, plus Node runtime import.
Physical external dependencies are reused/fingerprinted, not installed. The receipt
retains unchanged before/after SDK/dependency hashes; this is source-preview evidence,
not registry or released-artifact qualification. The final signed-source docs render
and exact-head independent review are retained separately after commit.


## Wave 6 — original invocation and verified coin ownership

Durable run/resume now capture the primitive canonical original ID, signal,
callback and explicit cancelled-resume choice before asynchronous journal access.
All run/resume/inspect/cancel loads reject a valid but foreign journal document
before consent or writes. The original signal remains live; replacing caller
options cannot change the admitted invocation. Invalid resume choices do not
authorize a cancelled intent. Existing original-ID, CAS, uncertainty and receipt
semantics remain. A small typed helper reduces the existing factory budget; no
new exception or retry is introduced.

The Midnight holding adapter now owns admitted fixed-size nonce/color bytes and
uint128 coin values before commitment/history work. Buffer aliases and changing
caller fields cannot replace the coin qualified under that commitment. Nullifier
callbacks and returned holdings receive separate owned copies. Existing inbox
noise handling, unique Merkle positions, spent checks, first-output deduplication
and eight-pair history batches remain. The complete indexer contract, not only
an inbox decoder, is documented in the library API guide.

The fresh isolated lifecycle lane waits for node block 2 before starting its
owned indexer, matching the regular prototype startup's genesis/SPO race guard.
Canonical finalized-indexer readiness remains a separate later prerequisite.
This predicate change is independently reviewed, not a native acceptance result.

The final integration gate passes **1,878 tests / seven existing skips**, all
builds and app typechecks. Independent focused review reruns **67/67 tests** and
finds no actionable issue. Those candidate checks ran on dirty base b7eafb4;
exact committed-head static review and fresh coverage/browser/consumer/render
receipts are retained separately rather than relabeling earlier evidence.

Library docs own invocation admission, holding input/output ownership, complete
ports and errors. Demo docs describe the selected app composition; these fixes
do not automatically make that app durable or enable any session policy. All
work remains local and unpublished. Native, provider, installed-release and full
Lace acceptance remain distinct from source/unit/browser-synthetic evidence.

The first post-documentation repeat exposed a synthetic test setup race: the
parent-interruption fixture allowed four seconds for runSuite source fingerprinting
and child readiness while coverage/browser checks competed for CPU. Its bounded
ready handshake now allows 30 seconds and fails early if the outer child exits;
the actual signal, cleanup-grace and no-later-scenario assertions are unchanged.
This is not a runtime timeout increase. Original failed gate output is retained;
a complete post-fix gate must pass before commit.


## Wave 7 — smaller revocation services, transport lifetimes and usable examples

P-256 selective and all-grant revocation now have typed preparation, signing,
recheck, dispatch and settlement phases. Complete-roster and single-detail policies
remain distinct. The original outer Flow and nested rotation Flow, credential
scopes, challenge timing, live source receivers, read-key exclusions and final
fresh assertion are retained. An unknown final dispatch is never retried or
converted into a revoked result. New public-account contracts exercise authority
mutation, exact traces, counter/generation rules and settlement/uncertainty.

The connector falls **1,362 → 1,057 lines**, factory **1,252 → 949**, maximum
complexity **45 → 15**, and non-null assertions **27 → 16**. Four new private
modules use default budgets, zero unsafe assertions and runtime phase functions
of at most 40 lines. Existing remaining factory/unsafe debt is still explicit;
this does not claim every large file has disappeared. Actual ceilings ratchet down.

Versioned proof/deploy jobs and raw durable mutation clients now use one monotonic
observation budget, including headers, bodies, pauses and safe GET retries. An
uncooperative injected fetch/JSON/cancel cannot keep the caller waiting past its
budget. Late bodies are disposed best effort and losing rejections are observed.
Small typed codec/outcome/response-owner/lifetime modules keep protocol retry,
continuation and error decisions in their respective facades.

The original V1 POST and raw execute POST are never replayed. GET retry preserves
the same job/cursor, with three retries only for transport failures. Whole event
batches are admitted before callbacks/cursor changes. Raw reconcile can finish
original approved preparation under the same identity; a failed POST does not
retry. Canonical mutation receipts have a derived 8,192-byte/64-step policy and
owned transaction-ID arrays. Generic V1 results retain their previously unbounded
size contract; it is not a universal proof-size limit. Synchronous V1 observer
ordering remains; returned async rejections are observed without awaiting them.
Legacy postService, synchronous sponsor, host-job/config transports remain separate.
The known synchronous sponsor observation gap is retained for a bounded follow-up.

Developer documentation fixes concrete contracts: cancellation/inspection do not
invoke the coordinator's consent callback; completed cancellation returns its
audit unchanged. The routine reader documents its scoped capability and the
difference between returning undefined and throwing. A complete source-only
verified-login handoff derives an owned wallet seed inside its callback and clears
it in finally. Browser storage states its ambient UUID prerequisite. Library
contracts and reference-app custody/approval policies stay in separate guides.

The worker guide now contains a complete explicitly started entry, and accurately
describes the client return shape. A regression executes that exact fence with
the actual SDK in an owned Node worker and browser event-capability shims. Removing
only startup produces the expected timeout; the worker is still terminated. This
is distinct from actual browser/native/provider acceptance. All 34 strict example
target compilations pass. Service docs now lead with reusable host integration,
then the demo composition; dated evidence is identified as history, not setup steps.

Focused results before root integration: **130 transport/compatibility tests**,
**101 revocation tests** (41 new), and the exact-worker regression pass. Independent
transport review reruns 90 cases and additional cursor/deadline probes with no
actionable findings; its owned loopback HTTP scope and closures are recorded.
The revocation and documentation cross-reviews, full root gate and fresh coverage
remain separate receipts. The earlier frozen 8c35cc4 native lifecycle run does not
qualify this later grant-revocation extraction or these transport changes.

The first native command refused Nix-added LD_DYLD_PATH before resource creation.
The documented command now removes that single metadata variable inside the
pinned shell while preserving all other loader/seed/preload guards. A fresh second
attempt owns new containers and frozen inputs; its result remains in progress.
Failed receipts, original IDs and user/unrelated resources are preserved.

Root integration first caught a test-only portability mismatch: the native Node
Response declaration marks json readonly, while the scoped DOM check allowed the
old assignment. The late-header fixture now wraps the actual native body/status/
headers in the structural port without mutating Response or asserting away the
type. Root Node-only strict checking and all 74 transport cases pass; the failed
first gate remains retained. Package runtime and reviewed hashes are unchanged.
Independent revocation review reruns 101 tests plus four source/authority timing
probes with no actionable findings. Final root integration evidence follows.

A final targeted teardown probe then found a P2 missed by the first broad transport
review: a throwing structural removeEventListener could discard a confirmed
receipt, and V1 could expose the cleanup diagnostic instead of its result/typed
error. The original eight control/fault probes are retained. The follow-up clears
owned timers, latches closed callbacks, catches synchronous cleanup failures and
observes async cleanup rejection without awaiting it. Caller detach remains best
effort; a refusing provider can retain an inert listener. New receipt/primary-error/
late-abort/actual-process closure tests and independent probe closure precede the
final post-fix gate and signature. Earlier passing coverage/browser/consumer
receipts retain their pre-fix hashes; they are not relabeled as final execution.

## Wave 7 accepted; next bounded integration checks

Signed head `02188b6fd5250de941912823945ed42de6fa0118` has a good intended GPG
signature, DCO and Assisted-by. Independent clean-head Codex CLI review found no
actionable issues in 166.46 seconds. The final full gate passes 2,026 tests with
seven existing skips. Fresh clean-head coverage is 94.96% lines / 93.63% functions /
86.81% branches; every package's 80% floors pass. All 192 synthetic browser journeys
and the nine-package/33-subpath copied-source checks pass with stable fingerprints.
The copied check resolves every runtime export and executes selected integration
imports; it is neither an installation nor execution of every public module.

Signed-source documentation renders 44 pages with 2,064 valid local targets.
Owned desktop/mobile navigation, keyboard and overflow checks pass and close their
browser/server. The exact worker documentation fence starts its server and passes
its executable regression; all 34 configured TypeScript example targets pass.
These local docs checks do not establish a deployed-site update.

The signed immutable wave 7 packet retains the original cleanup probes, their
independent closure and the earlier test-typing failure. All 2,288 artifact-index
entries verify, preserving previous rows and bytes. No push or publication.
The separate native run remains frozen at accepted wave 6, so it cannot qualify
this later P-256 revocation extraction or transport changes. Its final outcome and
owned cleanup will be reported separately.

The next bounded slice addresses a demonstrated explicit-timeout gap in the
synchronous V1 sponsor, checks actual offline-installed current-source tarballs,
and clarifies persistence ownership and HTTP client selection in the developer
guides. These are planned until their own implementation and receipts land.

## Wave 8: explicit sponsor lifetime and installed quality

The synchronous V1 sponsor now captures its factory fetch/timeout. Unset timeout
keeps the exact legacy path; a valid explicit timeout covers encoding, one POST,
headers, body and result projection. No default response cap, POST retry, caller
signal forwarding or durable query is added. A known non-200 response retains its
status classification when optional diagnostics stall. Expiry cannot undo a send.

Independent review found an encoding-time admission edge: an already expired
lifetime could expose its private interruption error. That is fixed and replayed
independently; both valid 1 MiB/1 ms cases now return the public typed timeout with
zero POSTs. The original probes remain retained. All 71 new and 23 compatibility
cases pass; the independent focused closure passes 90 cases. Shared lifetime, body
owner and legacy clients are unchanged.

A small opt-in installed-quality runner reuses the existing tarball audit, public
fixture text, documentation inventory and browser-access guard. Four helpers stay
below default size/complexity/unsafe limits. Fourteen new boundary cases plus 15
existing input/package tests pass. It checks matching audited installed roots,
strict Node/DOM/Worker declarations, verbatim documentation, actual JS/JSON export
imports and byte/tool/compiler drift. It neither installs nor publishes. Actual
nine-package staged installation remains a separate next verification step, not
a claim inferred from synthetic archives.

Developer guides now correct AccountRecordStore to metadata/counter only, map
each persistence owner, and distinguish actual public HTTP imports from wire
routes and legacy subpaths. The source-evaluation path requires no running demo
merely to check types/imports. Library policies stay separate from demo wiring.
The final local full Nix gate passes **2,111 tests / seven existing skips**, with
lint, formatting, builds and all app typechecks. Signing, exact-head review and
fresh installed/coverage/browser/doc receipts follow this frozen candidate.


## Wave 9: owned funding intent and smaller readiness phases

Funding requests now retain one admitted scalar snapshot across asynchronous
credential lookup, POST and response matching. Malformed IDs, pins and positive
U128 amounts refuse before credentials. Header callbacks retain their receiver and
are invoked once per explicit call. Explicit observation budgets include preparation,
credentials, headers, body and projection; late credentials cannot initiate a POST.
An unset budget adds no default timeout or signal. A returned resulting balance is
not a delta. There is no automatic retry, replacement ID or send reconciliation.

Sixty-seven new funding cases and three compatibility cases pass; independent
probes additionally cover encoding-time expiry, reversed concurrent credential
completion, mutable status/body values and late failures. The original mutation
and deadline failures are retained. These are adapter contracts, not live deposits.

The P-256 connector drops from 1,057 to 763 lines, its factory from 949 to 673,
and non-null assertions from 16 to 13. Five private readiness helpers use default
budgets with no unsafe assertions. Extraction preserves original late host-record
reads, strict challenges, Flow/session boundaries, directory retries/always-writes,
30 raw observation polls and durable effect IDs. Twenty-five new cases and four
actual pre-extraction-journal/current-code resumes pass. Existing focused coverage
ran before the final compatibility correction; the final full gate is still required.

The synthetic browser runner gains additive monotonic setup, checkpoint and cleanup
timings without changing case order or credential purposes. Checkpoint intervals
include UI work between assertions. They do not establish isolated case runtime,
hosted CI latency or native/provider support. The final complete both-arm run and
root integration gates follow these frozen implementation slices.


## Wave10: grant publication, observed teardown and installed crypto

The JubJub grant publisher is split into typed preparation, append and completion
phases. P-256 and shared crypto/publication validators remain unchanged. Valid
provider paths retain arm-specific consent/session/Flow/counter/settlement behavior.
A separately confirmed malformed-provider defect is corrected: missing required
seal pairs refuse with the existing typed error before signing/appending, rather
than reaching a credential action with an undefined entry. Original failing
probe and valid/continuation controls are retained with the implementation receipts.

A structural void teardown may return a rejected promise. Background channel
cleanup now observes that result through a private async try/await helper without
awaiting shutdown from close. Client pending reads retain their Closed/Unavailable
outcomes, and server stop still only unsubscribes. The first observer's dynamic
catch-method edge was independently found and fixed; original probes remain.
Final independent controls include decorated native promises, delayed rejection,
accepted reads, pending reads, repeated close and exact endpoint ownership.

Small opt-in installed-crypto modules execute six software/generated-contract
behaviors on audited public installed exports. They reuse archive/runtime checks,
not a source alias or TypeScript/docs compiler. Explicit bundle/lock pins, closed
case inventory, exact owned child limits, physical parent resolutions and final
byte audits are mandatory. The tool records a graph; separate preparation owns
its dependency/SRI approval. Narrow Node feature probes do not relax the import
lane. The first actual promoted-tool run passes on preserved W8 bytes only; final
current-source installation remains a separate required receipt.

The library guides document these contracts; application notes describe their
use in the demo. Root integration, exact-head review and final qualification
follow the frozen implementations. No push, registry/image publication or new
provider/native claim follows from these local changes.
