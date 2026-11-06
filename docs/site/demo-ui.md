---
layout: default
title: Prototype workspaces and host controls
permalink: /demo-ui/
---

**Local source after RC7.** The redesigned prototype demonstrates how the existing
Passport packages can be composed. It does not add an npm UI package, change the
ACC binding or establish new native/provider compatibility. Published RC7 and the
deployed site remain separate from this local work.

## Find an action

| Workspace | What belongs here |
| --- | --- |
| **Overview** | Create an account, open with a passkey, or open a known ACC address with an enrolled passkey. No name or profile creation. |
| **Passport account** | ACC state and balances, read shielded holdings, fund the ACC, withdraw to a Midnight user address. Amounts retain their original units and unavailable/stale states. |
| **Midnight wallet** | Separate built-in HD and optional external Lace Wallet views: addresses, balances, freshness and **Refresh wallet balance**. **Manage wallet connections** opens Settings. |
| **Audit** | Timed operation stages, full redacted request/response trace, public evidence JSON and **Copy full log**. |
| **Settings** | Security and access, wallet connections, and closed-by-default advanced developer tools. |

### Settings

- **Devices & passkeys:** prepare a joining device, read the device roster, enroll,
  remove an entry or rotate sealed viewing keys. Joining-device public handoff and
  roster details stay with these controls.
- **Sessions:** choose 10/15/30 minutes and caps, authorize an expiring JubJub
  grant, lock the local key or revoke the grant. Choose the asset/recipient in
  **Passport account** first; Settings displays the current target, and the actual
  authorization still reviews its exact scope. Critical owner operations always
  require fresh passkey consent.
- **Advanced access · manual grants:** holder preparation, roster, issue, export,
  spend, revoke and recovery. This is a separate advanced demonstration, not
  automatic permissions for a connected wallet.
- **Wallet connections:** connect the built-in wallet, or explicitly discover,
  select and review an optional [Lace Wallet connection]({{ '/lace-wallet/' | relative_url }}).
  Their snapshots remain separate; no ACC permission follows either connection.
- **Advanced · Developer tools:** advisory SDK capabilities/proof plans, the mock
  naming adapter, read-only network/binding/service/manifest build pins and prototype
  limits. These inputs do not certify live readiness or integrity. Configuration is not made editable and
  there is no operator-token field.

Security sections and Advanced start closed. Device/holder preparation mirrors
the explicit **Target Passport ACC address** used by Open by address; changing
that public input does not open, authorize or switch the active account. It is
disabled while an operation runs. A name lookup never fills it or a recipient.

## Progress and Activity

The existing weighted, staged progress bar stays in the center during work.
Time estimates stop below completion; unknown/unestimated progress is not a
confirmation percentage. Service/client clock differences are clamped for
presentation only; original events and IDs remain available in Audit.
Cancelled attempts and unknown outcomes never expose a completed 100-percent
progress value. A cancelled attempt does not imply that earlier effects rolled back.

Desktop has a collapsible right **Activity** panel: **Current operation** first,
then **Your journey**. Its compact summary links to the matching Audit run. Audit
starts with Activity collapsed to provide more room for exchanges. The journey
keeps a separate wallet connection optional; it is not a condition for ACC
ownership or access.

Mobile uses a native modal **Activity sheet** instead of a third column. Tab and
Shift+Tab stay inside; Escape/Close returns to the trigger. Dismissing Activity,
changing workspace or expanding a section never cancels, revokes, retries or
starts an account operation. Existing controls are moved, not recreated, so form
values, pending callbacks and transaction guards remain intact.

Passkey consent is a **different blocking dialog**, before every actual credential
request and retry. It prevents background navigation and Activity interaction.
The native provider dialog follows only after explicit approval. Cancelling an
attempt cannot undo earlier submissions. See [consent]({{ '/consent/' | relative_url }}).

## Uncertain results and evidence

An unknown funding/submission outcome keeps the original public request, flow or
intent references. A stopped/failed attempt is not proof of failed chain effects.
The summary asks for reconciliation and links to Audit; navigation never creates
a replacement request. A blocked session also displays a persistent safety notice
outside Settings, including its known original intent ID.

Audit is public history for **this page**, not an immutable chain history or a
replacement for durable journals. Reload does not recreate its entire display
history. Durable session/unknown-intent guards remain separately enforced across
reloads and tabs. Never clear site data or generate a new request ID to retry an
uncertain transfer. Read [session safety]({{ '/jubjub-sessions/' | relative_url }})
and the [funding/operator guide]({{ '/service/' | relative_url }}).

Audit rows use the same observed outcomes as Activity, including cancellation and
uncertainty. Exported runs retain the raw legacy attempt `result` and add `outcome`
for that derived presentation phase. Neither is a proof of ledger finality. Later
background events remain in the full trace without being attributed to an ended
attempt; session intents require a matching controller begin in their own action.
Validated submitted-grant transaction hashes stay visible with an unknown outcome
until reconciliation. The same roster error before submission is a distinct failed
attempt; an error code alone does not establish whether funds moved.

## Reuse without adopting this demo

| Layer | Responsibility |
| --- | --- |
| `account/interaction` | Framework-neutral immutable public snapshots, explicit-time arithmetic, stable reads/subscriptions and stale presentation-write comparison. No DOM, keys, timers or transactions. |
| Demo `OperationStatus`, `Journey` | Example DOM renderers accepting snapshots, ordinary labels and explicit Audit callbacks. They can be mounted independently and use host CSS variables. |
| Demo `ActivityPanel` | Subscribes and arranges operation before journey; detach removes only that renderer and subscription. It never disposes the account or revokes a grant. |
| Demo workspace | Navigation, disclosure, desktop rail/mobile sheet, focus handling and the current Midnight/Lace branding. |
| Host composition | Account adapters, durable journals, verified observations, permission reviews, credential requests and explicit account commands. |

The DOM renderers are app examples, not new published SDK exports. Ordinary labels
and CSS tokens such as `--heading`, `--text`, `--surface`, `--border` and `--accent`
can be supplied by a white-label host. Phase meanings, explicit consent and
transaction safeguards must remain accurate. Rendering, subscribing, remounting
or cleanup must not send a command. Two hosts can consume one public store with
independent themes, labels and cleanup.

The optional [React consumer example]({{ '/react-example/' | relative_url }})
demonstrates public-store wiring and StrictMode without an account or credential.
Its hook, HTML renderers and synthetic browser entry are separate modules.
The main packages stay framework-neutral. React Native needs separate platform
adapters and qualification. `lace-sdk` integration is outside this milestone;
Lace Wallet is a separate connection and grants no automatic ACC ownership,
viewing permission, spending permission or device enrollment.

## Run and check

Use the [existing local demo commands]({{ '/use-cases/' | relative_url }}); no new
backend or chain reset is required. For synthetic browser qualification:

```sh
nix develop -c pnpm run build
nix develop -c pnpm test:demo-browser
```

The runner owns a temporary Vite server and fresh contexts, intercepts the demo
origin and never connects to an existing user demo. It navigates through real
controls and checks both owner arms, mobile focus, consent layering, Audit links,
unknown IDs, pending-spend navigation and white-label renderer cleanup alongside
the existing account/device/grant/session journeys. Source-module GET retries are
bounded and do not replay any account or value request. Synthetic drivers and
mock WebAuthn remain distinct from native proofs and real-provider acceptance.

[Milestone](https://github.com/input-output-hk/midnight-passport-sdk/milestone/3)
and [#294](https://github.com/input-output-hk/midnight-passport-sdk/issues/294)
track final review, documentation and evidence.
