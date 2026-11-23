# Prototype UX and reusable host controls

Local execution on `codex/rc5-publication-record`, approved 2026-11-06.

- [Milestone #3](https://github.com/input-output-hk/midnight-passport-sdk/milestone/3)
- [Epic #287 and acceptance checklist](https://github.com/input-output-hk/midnight-passport-sdk/issues/287)
- [ADR 0014](../adr/0014-portable-interaction-models.md)
- [Portable interaction API](../site/interaction.md)

## Problem and result

The prototype demonstrates reusable Passport ACC packages, but its long page mixes
account operations, a separate HD wallet, security settings and diagnostics.
Engineers need to compose these capabilities without adopting the demo's layout,
brand or DOM. Users need a simple workspace and explicit passkey consent while
still being able to inspect public requests, responses and uncertain operations.

Deliver the approved navigation/workspace/Activity composition, keeping the
existing account API and all safety gates. No new product decision blocks the
first slice. The optional Lace Wallet path uses an inspected public connector read subset;
actual provider acceptance remains distinct from local synthetic qualification.

## Delivery map

| Issue | Deliverable | Local status |
| --- | --- | --- |
| [#288](https://github.com/input-output-hk/midnight-passport-sdk/issues/288) | Read-only naming port, checked helper and explicit mock | Implemented; independently reviewed; provider-copy follow-up included in the next slice. Production #247 remains open. |
| [#289](https://github.com/input-output-hk/midnight-passport-sdk/issues/289) | Portable operation/journey snapshots and subscriptions | Implemented in source with arithmetic consumed by the existing demo; validation/review required at the signed head. |
| [#290](https://github.com/input-output-hk/midnight-passport-sdk/issues/290) | Responsive workspace and Activity controls | Implemented locally; both-arm browser/focus/uncertainty qualification and signed review apply. |
| [#291](https://github.com/input-output-hk/midnight-passport-sdk/issues/291) | Settings and dedicated redacted Audit | Implemented locally; existing action nodes and intent guards preserved. |
| [#292](https://github.com/input-output-hk/midnight-passport-sdk/issues/292) | Optional React example and white-label composition | Local development example uses public snapshots and StrictMode; validation/review applies. No React dependency in SDK packages. |
| [#293](https://github.com/input-output-hk/midnight-passport-sdk/issues/293) | Bounded optional Lace Wallet connector | Implemented locally against the inspected public4.0.x/4.1.x read subset; synthetic acceptance only, no actual provider claim. |
| [#294](https://github.com/input-output-hk/midnight-passport-sdk/issues/294) | Browser/accessibility journeys, docs and handover | Local browser/unit/docs qualification and independent review recorded in the review map/checkpoint; hosted timing and actual providers remain separate. |

Issues remain open until review and integration. Local implementation is not a
published release or a change to the deployed documentation site.

## Approved information architecture

The local demo adds a small, app-owned rounded SVG icon set to workspace entries
and account entry actions. Text remains visible and supplies each control's
accessible name; no additional SDK UI dependency is required. See the
[UI guide](../site/demo-ui.md#stable-navigation) for reuse and accessibility rules.

- Left navigation: **Passport account, Midnight wallet, Audit, Settings**.
- The signed-out entry is the upstream-inspired **Sign up / Log in** landing, with the
  workspace rail hidden and Audit/Settings under **Demo tools**. The existing
  account controls and blocking consent are reused; successful account access
  opens Balances. It does not unlock a JubJub owner or connect a wallet. Other
  workspace navigation and unknown-intent guards remain independent.
- Passport account uses **Balances / Deposit / Withdraw** tabs, a shared open-ACC
  identity and one operation form at a time. Contract state is expandable; refresh
  and explicit shielded reads stay in Balances. Tab/keyboard/deep-link navigation
  never starts or cancels a transaction or credential request and preserves forms.
- Main workspace: selected user task and balances. Owner feedback on2026-11-06
  moves all operation progress, results and transient explanations into Activity.
  Estimated progress never implies confirmation.
- Collapsible right **Activity** panel: **Current operation first** with staged
  progress/results/notices, then **Your
  journey**. Compact operation summary links to Audit. Audit starts with the
  panel collapsed. Mobile uses an Activity sheet with focus containment/return.
- **Settings → Security & access**: devices/passkeys, bounded sessions, advanced
  manual grants. Sessions separates current local signer/recorded grant scope from
  the next session's draft target and grouped smallest-unit limits. Local Lock and
  confirmed on-chain Revoke remain distinct; exact IDs stay inspectable. Other
  Settings actions use separate cards; external Lace balances use structured facts.
  **Wallet connections** separates built-in and optional Lace
  Wallet sources. **Advanced**, collapsed initially, contains developer tools,
  network/binding pins, service/capability/proving diagnostics and the mock naming
  adapter. Do not invent editable operator configuration or token inputs.
- **Audit**: full redacted operation stages/exchanges, original IDs, evidence and
  copy/export. An unknown result retains its original request/intent and requires
  reconciliation; navigation never starts a replacement transaction.
- Passkey consent remains a separate blocking dialog before every credential API
  call and retry, including setup publications and strict-profile retries.

## Scope and gates

The nine implemented package set and pinned ACC binding remain. Use lightweight
subpaths and host examples before multiplying published UI packages. Foundation
libraries stay framework-neutral. React is optional wiring; React Native needs
platform adapters and separate evidence. `lace-sdk` integration is explicitly
outside this milestone. Lace Wallet connection alone grants no ACC ownership,
viewing access, spending permission or automatic enrollment.

No production naming, profile/name creation, dApp integration, multichain funding,
total-loss recovery or full Lace compatibility claim. Keep exact-value shielded
withdrawal guards. Preserve existing user demo resources, credentials, durable
fences and journals; tests own fresh resources only.

Each signed local commit needs the full repository gate. Meaningful browser
journeys must cover both owner arms, consent cancellation, stale/unknown outcomes,
navigation during active work, keyboard/mobile focus and redaction. Keep synthetic
UI, source, native, real-provider and released-artifact evidence separate. Avoid
key generation or native proof jobs in fast required CI; retain the 30–45 second
target described in [CI policy](../ci.md).

The local goal ends with docs, exact-head independent review and a clean signed
handover. Push, merge, release and Pages publication are separate actions.

### Midnames lookup source preview

The [local launcher](../../examples/midnames-local/README.md#open-the-local-passport-and-midnames-demo)
now provides a checked way to open this opt-in demo against a running Ledger 9
stack or a separate Passport-owned fallback. It pins a finalized name claim,
live registry target, and supported ACC before the browser enables the named
NIGHT control. Account setup on a new chain is a separate stage; a newly
created source remains unfunded until the operator funds it.

The Name service panel can use an explicitly configured Midnames registry.
A partial configuration disables lookup and shows the setup requirement.
Lookup reads the registry and supported target ACC at one indexer block,
then displays the checked contract target without initiating an account or
wallet action. With a node chain pin, it checks that block against the node's
finalized canonical chain before reading either contract. The indexer remains
a trusted source of the contract-state bytes. An online
profile requires a public known-name-to-ACC
pin, two distinct-origin indexer paths and a separately pinned node. Each lookup rechecks the pin and
requires both paths to agree; changed, divergent or unavailable observations
refuse the lookup. See the [configuration and evidence scope](../site/names.md#source-preview-midnames-210).

### Standalone .night claim recovery

The opt-in localhost demo can use the open account's passkey to prepare a
claim. The quote review describes the passkey request before the user approves.
After reload, the account-opening control becomes ready only after its action
handler is attached, so a fast click cannot be dropped during startup.
The owner bundle rechecks the current root price and payee before requesting
the credential. Receipt recovery remains a read, and dispatch remains a
separate action.
The localhost sponsor balances the transaction to the displayed quote expiry and
refuses preparation when the reviewed quote has too little time left. The page
still requires a separate payment review and send confirmation; an uncertain
send keeps the original receipt for fence and indexer reconciliation.

With a host preparation adapter, **Continue registration** checks any retained
original and shows the exact destination and sponsor terms. **Approve with
passkey** saves the quote
and owner commitment before the sponsor request. If the response is lost,
**Recover prepared receipt** looks up that original. The user can also import
the matching public receipt. The current browser preparation test uses a
simulated wallet host. The loopback sponsor retains the quote and original
balance intent independently of the browser. Live browser proof preparation and receipt acknowledgement
have their own isolated evidence.
If the sponsor durably refuses changed terms before recording an intent, the
browser can review a new quote. An unknown result stays bound to the original.
The synthetic full-app fixture checks unavailable and wrong-ACC quotes before
proof, review clearing when the name changes, and a pre-intent refusal followed
by a newly reviewed retry. Native sponsor failure and real passkey consent
remain open qualification.

The opt-in **Register a .night name** panel on Passport account → Balances
appears after creation or passkey-based opening of the target ACC. The claim
panel can suggest a random local `demo-<24 hex characters>.night` label when the field is empty;
it first checks for an earlier selection under the same credential and restores
that selection instead of replacing its original. A suggestion is not an issued
name, reservation, quote or transaction. The user still reviews the registry
result, quote, passkey request and payment separately. The claim
profile requires the observed Indexer v4 transaction protocol
pin (`2001100` on both the shared Ledger 9 demo and the release-image isolated fixture).
This is separate from the `/api/v4/graphql` endpoint version. Reviewing a
valid quote retains the selected local `.night` name per registry, ACC, and
credential. It restores that selection after reopening and keeps the setup pending until the original
transaction and current registry record match. It does not deploy another ACC
or automatically send a claim. Availability and imported-receipt checks do not
select a name; enter it again after a reload. The panel can save a standalone sponsor receipt.
For a retained original, reopening also checks the sponsor's dispatch fence and
shows **Prepared but never sent** when the sponsor confirms that state and the
registry still shows the name available. It does not show registration success.

For the provisional Ledger 9 `acc-s3r1.1-zkir036` source profile, the
[local launcher](../../examples/midnames-local/README.md#provisional-acc-local-demo-profile)
can open account creation and the standalone name panel in one browser
session. It uses a separate deployment registry and claim journal and admits
the candidate only with exact build pins and loopback Indexer API v4. This
configuration route is now qualified for the bounded local journey below. In the
local launcher, candidate ACC proofs use the shared release prover on 6300;
the pinned Compact 0.35 standalone name registry uses an owned compatibility
prover on 16320. The browser and sponsor journals must be checked together
after a fresh native claim run before reporting the journey as qualified.
The rebuilt Compact 0.36.1 registry has a separate, explicitly isolated local
claim profile. Its page recovery control requires the candidate ACC pin and
local node/indexer/prover endpoints; it does not change the shared demo's
registry. The [isolated page-to-chain receipt](../../examples/midnames-local/evidence/compact0361-page-claim-20261123.json)
records one reviewed page original, sponsor dispatch, indexed SUCCESS and
same-profile recovery after a lost response. Its source ACC was activated
before the browser run, and its login connector and credential were synthetic.

The [subsequent real-connector run](../../examples/midnames-local/evidence/compact0361-real-connector-onboarding-20261123.json)
created a fresh ACC, claimed a new `.night` name, and reopened both in one
virtual-credential browser profile on the isolated 0.36.1 chain. Its one
original finalized and the canonical registry target matched that ACC. An
earlier browser-driver reopen timeout after a successful claim was preserved
and audited without sending again. A later fresh-account run confirmed that a
taken name, indexer outage and sponsor quote outage refuse safely without a
second claim dispatch; the registered name remained visible afterward. Physical
providers and independent online resolution remain unqualified.

The [0.36.1 named-payment native receipt](../../examples/midnames-local/evidence/compact0361-paid-name-night-send-20261123.json)
uses that already paid name as a recipient on the retained isolated chain.
One reviewed Node JubJub intent withdrew 4 NIGHT, paused, recovered the same
intent, and deposited the exact bridge output. The node and indexer confirmed
both originals, with source/target balances 10/0 → 6/0 → 6/4 and no replay.
The page admits this profile only with the isolated registry and candidate
ACC pins. A later [connected browser receipt](../../examples/midnames-local/evidence/compact0361-connected-browser-night-send-20261123.json)
created and funded a fresh JubJub ACC, funded its separate device wallet,
registered DUST, and sent 1 NIGHT to that paid name from the Passport page.
Both original legs finalized in canonical blocks; one reviewed intent moved
to browser history with no active payment. The first verification driver
timed out on a hidden Open button after reload; a later read-only run in a
fresh Chrome process reopened the same ACC with the same mock passkey and
refreshed its state from the chain. At one node-finalized block, the sender
held 9 NIGHT units and the recipient held 5. The payment was not resent.
Physical passkeys and online providers remain unqualified.

The [shared-chain browser receipt](../../examples/midnames-local/evidence/candidate-acc-combined-local-claim-20261122.json)
records one synthetic ACC creation, same-profile paid `.night` claim, exact
indexed success and matching registry target. Those steps span signed source
heads; the final head rechecked the saved registration without another send.
The later [one-head local run](../../examples/midnames-local/evidence/candidate-onehead-create-claim-pay-20261122.json)
completed ACC creation, a new name claim and named NIGHT payments with a
synthetic passkey on the shared chain. It does not qualify a physical provider,
online naming or a released candidate binding.
The named-send preflight now gives distinct plain-language refusals for an
unknown name, a name pointing to the source ACC, an unsupported ACC, and an
insufficient source balance. An unavailable naming provider is reported as
unavailable, not as an unregistered name. No owner ceremony or payment starts
for these cases.
For local name registration, a competing quote moved into an archived sponsor
journal can be refused as never balanced without assigning its owner to the
first lookup caller. Only the credential's matching quote-and-owner reservation
is released; any recorded owner decision stays bound to that owner.
The local launcher now accepts an explicit claim journal ID for a separate new
account/name after an earlier claim has been confirmed. It preserves the first
journal and requires the same ID for that claim's recovery; switching IDs is
not a safe retry after an unknown outcome. The sponsor wallet remains single
writer under the shared lease.
Candidate demo funding now uses a dedicated wallet and state files when the
operator explicitly combines `--candidate-assets --funding`. The candidate
wallet uses port 18789, separate from the stable demo on 8789. The funding
service's [native shared-chain run](../../examples/midnames-local/evidence/candidate-funding-native-20261122.json)
confirmed its original request, indexed 10-unit NIGHT credit and same-ID
replay. A separate [headless Passport page run](../../examples/midnames-local/evidence/candidate-funding-browser-20261122.json)
confirmed a second 10-unit NIGHT credit through the live candidate services,
finalized chain action and reload without a duplicate request. It selected the
existing ACC through a test connector; the combined passkey/worker path remains
open. The connected named NIGHT page source
now checks the exact candidate binding and manifest through page selection,
owner review, host admission and deposit preflight. Its browser journal also
pins the candidate profile so a stable or changed binding cannot resume its
original. The launcher defaults to `VITE_MIDNAMES_NIGHT_SEND=0` for candidate
assets and enables it only with explicit `--night-send --claim --funding`
and `--candidate-assets`. Headless candidate checks cover visibility and the
saved-original no-ID guard, while the host tests simulate its two legs. A fresh
isolated [native run](../../examples/midnames-local/evidence/candidate-acc-adapter-named-night-send-20261122.json)
settled both legs with the exported recipient deposit adapter at one signed
head. It does not prove a connected browser withdrawal-to-deposit payment or
recovery by itself. A later [connected browser run](../../examples/midnames-local/evidence/candidate-connected-browser-night-send-20261122.json)
created and funded a fresh ACC, registered DUST for its separate device wallet,
reviewed a named 4 NIGHT payment, and finalized one withdrawal and one deposit.
It reconciled those exact IDs after a browser deposit resume, then reopened to
confirm an archived journal and source/recipient balances of 6/28. This run
spans signed heads and used an already registered name. A later
[one-head local browser run](../../examples/midnames-local/evidence/candidate-onehead-create-claim-pay-20261122.json)
created a new ACC, claimed `codexflow24.night` after activation, funded the ACC
and a separate device wallet, registered DUST, and paid 4 NIGHT to the already
registered `codexacc22.night` ACC. Both original legs finalized; one explicit
original-only browser check archived them after finality. A follow-up payment
on a later signed head exercised the automatic finality wait and finished
without that extra click. This is a synthetic-credential local result, not
physical-passkey or online-provider acceptance. The candidate launcher stays
disabled without its explicit opt-in.

An unavailable indexer leaves the original receipt intact and reports the
check as unavailable. Without claim preparation or sponsor dispatch, the panel
is labelled read-only receipt inspection and offers no claim action.
An original retained under a different credential reports a claim conflict
instead of a generic provider outage. A synthetic full-app browser check now
opens the panel after creation and reopening, verifies that the second
credential cannot inherit the first one's local receipt, and counts one stub
`createAccount` invocation. It also checks the failed-original release and
archived receipt across reload in an isolated browser profile. The same profile
can then prepare a distinct synthetic original while retaining the failed one
in history, without creating another ACC or dispatching a claim. A conflicting
status hides release; an unavailable recheck hides it until the user checks
the original again. A third isolated profile confirms that a same-origin HTTP
sponsor quote is displayed before any synthetic owner proof or preparation,
that approval calls each once, and that a pending original reports the
synthetic prepared-but-unsent sponsor state after reopen. Native
create/open, actual indexed failure, real passkey review and sponsored retry
acceptance remain separate.
For the local sponsor, an exact indexed failure remains retained until its
private journal is archived. **Release failed original for a new attempt** now
requires the sponsor to verify the prepared bytes, dispatch fence, exact indexed
transaction, canonical finalized block, free name and supported ACC, then archive
the entire private journal before the browser releases its record. The indexed
result can be `FAILURE`, or a
`PARTIAL_SUCCESS` with a verified failed registration claim and only a successful
sponsor DUST fee. The fee is not refunded. The action rechecks the same outcome and availability,
archives the public receipt and original transaction IDs, and clears the prior
selection atomically. A fresh quote review is required before another
preparation. Other partial outcomes, outage, uncertainty and changed binding keep the
original fenced. The archived receipt can be inspected after reload. A second
browser's quote moved with the archive is recovered by exact quote lookup and
an explicit no-intent refusal; corrupt or missing archives fail closed. Unit,
HTTP and synthetic Chromium checks cover these paths. An isolated Ledger 9 run
at signed `46add31e` also verified exact sponsor retirement after a fee-only
indexed claim failure, before the browser released that original. This does not
qualify every failure shape or an online sponsor.
**Check original
claim** reconciles the stored transaction, local sponsor dispatch fence, and current registry owner and
target. **Check registry status** verifies the open ACC and checks whether the
name is registered. When a receipt already exists, the button reconciles the
original claim. The loopback fixture offers **Review terms before send** for an
original receipt already saved to the open credential. A lost response keeps the original receipt available across
browser reloads. Sending requires a saved matching quote and a second click
after the exact payment terms are displayed. Older quote-less receipts remain
available for reconciliation only. A prepared, unfenced receipt is explicitly
shown as unsent; after expiry, the sponsor can verify and archive it before a
fresh quote. A fenced or uncertain original stays pending. The older native dispatch fixture injects its
quote after proof, so that run does not qualify pre-proof user review. See
[the recovery flow](../site/names.md#recover-the-sponsors-original-claim-in-the-demo).
The separate native `claim-preproof` fixture displays a fixture-issued quote
in owner Chromium and requires an automated approve click before naming PRF
and proof. Its signed `e456638` fresh run passed with one sponsored claim and
recovery after restart. Virtual credential enrollment happened before quote
display; sponsor HTTP quote issuance, the full demo create/open panel, and
human or real-provider approval remain separate gates.

Signed source `46add31e` passed a later isolated Ledger 9 claim retry through
the actual Passport name form. After a separately archived indexed failure,
the form obtained one fresh sponsor quote, proved with a virtual PRF credential,
prepared and sent one reviewed original, then reopened the same browser profile
after a lost sponsor response and confirmed its indexed success and live name
binding. The ACC login connector supplied an already activated test account.
The failed original used another browser profile; real providers, combined ACC
creation and online Midnames remain separate gates. See the
[redacted receipt](../../examples/midnames-local/evidence/release-ledger9-page-claim-retry-20261120.json).
Signed source `e3ec3608` passed a fresh isolated Ledger 9 run that imported the
indexed failed original into the retry page profile, released it through the
same sponsor's archived journal, retained it after reload, then prepared and
sent a distinct claim once. After a lost sponsor response, that profile
recovered indexed `SUCCESS` and the live binding to the same ACC. The first
original was prepared outside the page; combined ACC creation, real-provider
consent and online Midnames remain separate gates. See the
[redacted same-profile receipt](../../examples/midnames-local/evidence/release-ledger9-page-same-profile-20261120.json).
Signed source `4a6c7642` then passed a fresh isolated run with both originals
prepared inside the same persistent Passport page profile. The first send lost
its HTTP acknowledgement but finalized as a fee-only claim failure; the
sponsor archived it and the page retained the released original across reload.
The second reviewed claim finalized successfully and the page recovered the
same-ACC binding after a lost response. See the
[redacted two-original receipt](../../examples/midnames-local/evidence/release-ledger9-page-two-originals-20261120.json).
The ACC login connector still supplies an already activated account, and the
naming credential is virtual. Combined account creation and real-provider
consent remain open.

### Standalone shielded deposit by name

The independent sender exercise covers a named ACC's shielded receive path on
`undeployed`. The owner receives and verifies a holding without supplying
credentials or private state to the sender. See the
[standalone recipe](../../examples/midnames-local/README.md#run-the-shielded-deposit-by-name).

The optional sender-owned localhost page shows the exact resolved target and
synthetic asset before preparation. A signed-source isolated run at `b87ed6c`
passed with an automated browser approval, one finalized sender dispatch and
an independently verified owner holding. Its visible manual mode is available
for a human-run local demonstration but has not been qualified here. This does
not add a named-send page to the Passport owner demo or qualify an online
provider.

A later shared Ledger 9 run at signed `8165c73` used an existing claimed
`paidfix.night` and activated ACC. The separate sender browser approved a
10-unit synthetic shielded deposit, one original transaction finalized, and
the saved development mock-passkey owner reopened that same ACC and read the
matching chain-verified holding in **Balances**. The reference demo did not
initiate the sender payment. A shutdown smoke at signed `d5fc680` verified
that the demo service drains before its shared sponsor lease and chain marker
are released.

### Standalone ACC-to-ACC payment by name

The isolated NIGHT fixture reviews both operations together and keeps original
withdrawal and deposit references. An interrupted withdrawal-to-deposit flow
remains visible in the journal. See the
[standalone recipe](../../examples/midnames-local/README.md#run-the-named-acc-to-acc-night-payment).

The optional localhost owner browser page now shows the source ACC, named
recipient ACC, controlled bridge, amount and both operations before the
synthetic owner signature. A signed `ec83ce9` isolated run passed with an
automated approval, one withdrawal, an interruption before deposit, then
original-intent recovery and one deposit to 6/4 balances. Its manual browser
mode is available for a human-run local exercise but has not been qualified
here. This does not add a send page to the Passport demo or establish real
passkey consent.

At signed `a20a9b9`, the isolated automated browser decline retained 10/0
source/target ACC balances and made no owner signature, withdrawal, deposit or
payment journal entry. The helper now treats page close and timeout as errors;
only a completed **Decline** click qualifies this negative result.

At signed `e8fd610`, another isolated run approved the original named NIGHT
route in the localhost browser, then changed `alice.night` on-chain to a third
activated ACC before owner signing. Fresh resolution saw the new target, but
the reviewed intent kept the original target. The fixture refused the send
with no owner signature or payment dispatch and 10/0/0 ACC balances. This is
a local change-after-review case, not a Passport demo send page or online
provider qualification.

The source-only browser journal for this route retains one active reviewed
intent per source ACC on the demo origin, with durable per-leg identifiers and
credential scope. It refuses another request while the original is active;
both legs must pass a finality check before the host can archive it. The
owner-send page and its passkey/bridge adapters remain to be connected and
qualified, so this storage path is not a completed demo send journey.

An opt-in source API now gives the host finalized unshielded-withdrawal IDs
before submission and awaits its durable callback. Unsupported chain adapters
refuse before owner signing. The opt-in local reference demo now wires the
browser journal and second payment leg; no new native/provider run qualifies
that path.

The source-only NIGHT orchestrator now accepts an account-owner callback path:
it rechecks the named route at the finalized pre-submit point and commits the
original withdrawal IDs before dispatch. A name refusal before entering the
owner API can retire the unsubmitted intent into audit history. A durable
owner-start marker keeps later no-ID outcomes blocked; a lost reply retains
the original for lookup. A source
helper binds the selected JubJub ACC to the reviewed NIGHT amount and bridge.
The opt-in local demo now wires that helper, the bridge/finality adapter and
send control. Native browser qualification remains open.

The source owner-consent model can stage the exact named NIGHT request in the
actual passkey review: name, registry, recipient ACC, bridge address, amount and
withdraw/deposit operations. An opt-in finalized callback checks that approved
scope again before the journal fence. The ACC signs the bridge withdrawal;
the name and recipient ACC remain host-checked rather than signed circuit
fields. The opt-in local demo control now uses this seam, without a qualified
native browser payment.

The local NIGHT fixture now uses a reusable source guard for the exact bridge
output and balanced deposit input. It refuses a different withdrawal identity,
extra output or substituted deposit coin before the second dispatch. The
browser deposit wallet and send control remain open work; source tests do not
establish another native payment.

An internal built-in wallet worker port observes the exact bridge output and
can prepare one device-held recipient deposit for a future demo send control.
It checks its own raw address, a strict NIGHT sync snapshot, one ACC deposit
action and exact original coin input before exposing the finalized original.
The host must durably fence that original; the worker independently reads the
matching IndexedDB record before accepting one dispatch.
The public connector stays read-only. The browser send control and native
qualification remain open work.
