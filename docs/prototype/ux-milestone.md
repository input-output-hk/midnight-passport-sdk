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
first slice. Public connector capabilities need verification before enabling a
Lace Wallet path; that verification is an implementation task, not an assumption.

## Delivery map

| Issue | Deliverable | Local status |
| --- | --- | --- |
| [#288](https://github.com/input-output-hk/midnight-passport-sdk/issues/288) | Read-only naming port, checked helper and explicit mock | Implemented; independently reviewed; provider-copy follow-up included in the next slice. Production #247 remains open. |
| [#289](https://github.com/input-output-hk/midnight-passport-sdk/issues/289) | Portable operation/journey snapshots and subscriptions | Implemented in source with arithmetic consumed by the existing demo; validation/review required at the signed head. |
| [#290](https://github.com/input-output-hk/midnight-passport-sdk/issues/290) | Responsive workspace and Activity controls | Pending. |
| [#291](https://github.com/input-output-hk/midnight-passport-sdk/issues/291) | Settings and dedicated redacted Audit | Pending. |
| [#292](https://github.com/input-output-hk/midnight-passport-sdk/issues/292) | Optional React example and white-label composition | Pending; no React dependency added to core packages. |
| [#293](https://github.com/input-output-hk/midnight-passport-sdk/issues/293) | Bounded optional Lace Wallet connector | Pending verification of the public connector contract and network capabilities. |
| [#294](https://github.com/input-output-hk/midnight-passport-sdk/issues/294) | Browser/accessibility journeys, docs and handover | Per-slice checks; final milestone qualification pending. |

Issues remain open until review and integration. Local implementation is not a
published release or a change to the deployed documentation site.

## Approved information architecture

- Left navigation: **Overview, Passport account, Midnight wallet, Audit, Settings**.
- Main workspace: selected user task; the existing staged deployment progress bar
  stays here during setup. Estimated progress never implies confirmation.
- Collapsible right **Activity** panel: **Current operation first**, then **Your
  journey**. Compact operation summary links to Audit. Audit starts with the
  panel collapsed. Mobile uses an Activity sheet with focus containment/return.
- **Settings → Security & access**: devices/passkeys, bounded sessions, advanced
  manual grants. **Wallet connections** separates built-in and optional Lace
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
