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

## Acceptance and execution backlog

| ID | Deliverable | Required observable outcome | Initial status |
| --- | --- | --- | --- |
| O1 | Consent consolidation | One app review before each actual credential request; retain exact transaction/device/grant approval and create maintenance acknowledgement; cancel invokes no credential; retries are fresh; no stale-lease fallback | Implementation in progress |
| O2 | Entry navigation | No Overview menu item. Signed-out entry offers Sign up/Log in; authenticated home navigation opens Account balances without another credential, account reset or lost draft | Implementation in progress |
| O3 | SDK boundary defects | Grant-holder review/sign/send use one immutable admitted input; bounded decimals before BigInt; Node Buffer session reads do not erase retained keys | Confirmed defects; fixing |
| O4 | Reusable API and domain readability | Extract cohesive responsibilities from measured large files, clear capability/custody/authority naming, no API/recipe churn or inflated quality ceilings | Baseline audit underway |
| O5 | Input and platform contracts | Zod/branded admission where needed; safe malformed/oversized/mutating input handling; browser/Node import/type behavior preserved | Independent adapter audit underway |
| O6 | Browser coverage | Playwright journeys cover successful/cancel/retry/expiry/navigation flows and exact request counts; actual DOM/worker/storage tests distinguish synthetic account/chain from native evidence | Existing188journeys; updating |
| O7 | Promptless upstream behavior | Pin current staging/public source; explain persisted-key restoration vs fresh authentication. Any implemented resume never infers private authority from machine trust or public hints | Research complete; integration design pending |
| O8 | Human copy and docs | Remove redundant reassurance, keep meaningful action/scope/recovery information, align API examples, agent guide and architecture decisions | Consent/landing copy underway |
| O9 | Independent handover | Sub-agent reviews plus independent exact-head review, signed local commits, passing gates/coverage/consumer checks, signed immutable packet and updated checkpoint | Per-tranche and final gates pending |

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
acceptance. The signed head and independent review belong in the final checkpoint.

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
