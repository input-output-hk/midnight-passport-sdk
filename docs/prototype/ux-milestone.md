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

The Name service panel can use an explicitly configured Midnames registry.
A partial configuration disables lookup and shows the setup requirement.
Lookup displays a checked contract target for inspection without initiating an
account or wallet action. See the [configuration and evidence scope](../site/names.md#source-preview-midnames-210).

### Standalone .night claim recovery

With a host preparation adapter, **Review claim quote** shows the exact
destination and sponsor terms. **Approve and prepare claim** saves the quote
and owner commitment before the sponsor request. If the response is lost,
**Recover prepared receipt** looks up that original. The user can also import
the matching public receipt. The current browser preparation test uses a
simulated wallet host. The loopback sponsor retains the quote and original
balance intent independently of the browser. Live browser proof preparation and receipt acknowledgement
have their own isolated evidence.

The Name service panel under **Settings → Developer tools** can save a
standalone sponsor receipt after the user opens the target ACC. **Check original
claim** reconciles the stored transaction and the current registry owner and
target. **Check availability** verifies the open ACC and checks whether the
name is registered. When a receipt already exists, the button reconciles the
original claim. The loopback fixture offers **Send prepared claim** for an
original receipt already saved to the open credential. A lost response keeps the original receipt available across
browser reloads. See [the recovery flow](../site/names.md#recover-the-sponsors-original-claim-in-the-demo).

### Standalone shielded deposit by name

The independent sender exercise covers a named ACC's shielded receive path on
`undeployed`. The owner receives and verifies a holding without supplying
credentials or private state to the sender. See the
[standalone recipe](../../examples/midnames-local/README.md#run-the-shielded-deposit-by-name).

### Standalone ACC-to-ACC payment by name

The isolated NIGHT fixture reviews both operations together and keeps original
withdrawal and deposit references. An interrupted withdrawal-to-deposit flow
remains visible in the journal. See the
[standalone recipe](../../examples/midnames-local/README.md#run-the-named-acc-to-acc-night-payment).
