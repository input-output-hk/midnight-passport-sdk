---
layout: default
title: Prototype workspaces and host controls
permalink: /demo-ui/
---
**Updated local-source policy:** [Unlock account]({{ '/authenticated-owner/' | relative_url }})
authenticates a deterministic JubJub **full owner** for all implemented owner operations.
That mode does not require a fresh passkey for administration or permission changes.
The older reading-only/scoped-session mode below retains its passkey fallback; its
child key is not a full owner. Operation reviews, local expiry and unknown-intent
fences remain. These additions are not in published RC7.



**Local source after RC7.** The redesigned prototype demonstrates how the existing
Passport packages can be composed. It does not add an npm UI package, change the
ACC binding or establish new native/provider compatibility. Published RC7 and the
deployed site remain separate from this local work.

## Find an action

| Workspace | What belongs here |
| --- | --- |
| **Overview** | Landing page with **Sign up** and **Log in**, plus secondary account-address login. **Demo tools** keeps Audit and Settings reachable. No name or profile creation. |
| **Passport account** | **Balances**, **Deposit** and **Withdraw** pages under its left navigation entry. The selected ACC/network stays visible; each operation has its own form. Amounts retain their original units and unavailable/stale states. |
| **Midnight wallet** | **Built-in wallet** and **Lace Wallet** pages: addresses, balances, freshness and **Refresh wallet balance**. **Manage wallet connections** opens Settings. |
| **Audit** | **Event log**, **Requests & responses** and **Export JSON** pages, with **Copy full log** on every page. |
| **Settings** | Devices, quick actions, permissions, wallet connections and developer subpages. |

### Stable navigation

The demo's small SVG set uses rounded 24-unit outlines for the five workspace
entries and the create/passkey entry actions. Icons are decorative, unfocusable
and inherit `currentColor`; visible labels remain the accessible names. Active,
disabled and focus states still belong to the control. Submenus keep text labels
to avoid visual clutter. These app-owned assets (`src/icons.ts` and
`.passport-icon`) can be restyled by a host; the SDK packages have no icon, DOM or
branding dependency. A fingerprint indicates passkey access, not that a device
has a fingerprint sensor or that authentication already succeeded.

Outside the landing page, all desktop groups stay visible in the left rail, so selecting a page never moves
other menu entries. Navigation and content scroll independently; changing content
cannot resize or scroll the navigation rail. Page focus uses `preventScroll`.
The active page has a clear outline and `aria-current="page"`; navigation uses
ordinary links: Tab or optional arrow/Home/End keys move focus; Enter activates
the focused page. Moving focus alone never changes the selected page. A **Skip to
content** link bypasses navigation. There is no application-style ARIA menu.

On compact screens **Menu · current section** opens a modal navigation drawer.
Escape/Close restores the menu button; choosing a destination closes the drawer
and focuses its heading. The content viewport keeps the same position and size.
The same navigation nodes move between layouts; controls are never duplicated.
Passkey consent and the separate Activity sheet remain blocking dialogs.

Page selection preserves drafts and starts no account, wallet or network action.
`#account/<page>`, `#wallet/<page>`, `#audit/<page>` and `#settings/<page>` deep links
restore presentation only. Unknown child routes use the section's initial page.

These choices follow [WAI's navigation guidance](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/examples/disclosure-navigation/)
and [the browser focus API](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus).
Synthetic keyboard/layout tests do not establish assistive-technology certification.

### Wallet and Audit pages

- **Midnight wallet → Built-in wallet** shows the separate passkey-derived HD wallet
  and its explicit balance refresh. **Lace Wallet** shows the external wallet snapshot
  and explicit external refresh. **Manage wallet connections** opens Settings;
  navigating to either page never connects or reads a wallet.
- **Audit → Event log** shows timed operations. **Requests & responses** shows the
  full redacted trace directly. **Export JSON** shows public evidence JSON.
  **Copy full log** is available on every Audit page and still copies the full
  redacted record, not just the current page. Activity's Audit links open the
  matching event in Event log, including cancelled and unknown outcomes.

### Start from Overview

Overview is a landing page inspired by the current upstream Passport design:
a decorative Passport card and short introduction sit beside a **Get started
with Passport** card. **Sign up** is primary; **Log in** is secondary. These labels
reuse the existing create/open controls and handlers. Sign up still requests the
irreversible maintenance-retirement acknowledgement; every actual credential
request has its own blocking review. An open account and an unlocked JubJub owner
remain separate states.

The workspace rail and mobile Menu are absent on this entry page. **Demo tools**
offers Audit and Settings without requiring account access. Other workspaces keep
their existing navigation; Activity still displays progress, failures and unknown
outcomes during entry operations. Merely navigating never authenticates a user.

**Log in with an account address** expands the existing address form. Paste the
64-character lowercase hexadecimal address and use an enrolled passkey; an address
alone grants no access and cannot recover a lost passkey. Expanding the form or
editing its draft starts no credential operation. Drafts survive local navigation.
Successful creation, passkey login or address login opens **Passport account →
Balances**. A declined or failed attempt does not redirect to an account; Activity
and Audit retain its original evidence and uncertain IDs. Returning to Overview
does not log out, revoke authority or erase local records.

The illustration and CSS are demo-owned. SDK consumers can compose the same
headless account capabilities with their own brand, layout and consent host.

### Passport account operations

- **Balances** shows the ACC’s unshielded balances and **Refresh ACC state**.
  Contract counters, binding and last-transaction details are expandable. A failed
  balance refresh labels prior amounts as old snapshots; unavailable balances do
  not mean zero. **Shielded holdings** has a separate explicit read action and
  passkey consent; merely opening this tab never unlocks the sealed inbox.
- **Deposit** shows one asset selector and the funding action. The configured
  fixed deposit comes from the **demo funding wallet**, not your connected wallet.
  The tab explains when funding is unavailable instead of offering a new route.
- **Withdraw** shows one form for the asset, amount in smallest units and an
  explicit unshielded Midnight recipient. The subsequent review chooses the
  applicable scoped-session or fresh-owner route; selecting a tab grants nothing.

The open ACC/network stays above the selected form. **Balances**, **Deposit** and
**Withdraw** appear beneath **Passport account** in the left navigation. Keyboard
users can use Tab/Enter or Up/Down and Home/End within this submenu; Left/Right
also remain supported. On mobile, choose the page in the navigation drawer.
`#account/deposit` and `#account/withdraw` open those views without starting an
operation. Form values and the selected tab survive navigation to another
workspace in the same page; reloading does not restore a signing key or draft.
Settings → Quick actions’ target shortcut opens **Withdraw** and focuses the recipient.
During pending or unknown transfers, navigation keeps original IDs and guards;
progress and results stay in Activity. Tabs never resubmit, sign, refresh or cancel.

### Settings

Settings pages appear beneath **Settings** in the left navigation: **Devices & passkeys**, **Quick actions**,
**Permissions**, **Wallet connections** and **Developer tools**. One page is
visible at a time; navigation preserves drafts and starts no account action.
For example, `#settings/sessions` opens Quick actions, and `#settings/wallets`
opens wallet connections. Unknown subpages fall back to Devices & passkeys.
Full identifiers may still use small technical disclosures inside a page.

**Quick actions** has an explicit 10/15/30-minute unlock for routine reading and
wallet connection. The separate transfer-permission controls issue a capped
JubJub grant with fresh owner approval. See [the guide]({{ '/quick-actions/' | relative_url }}).

- **Devices & passkeys:** prepare a joining device, read the device roster, enroll,
  remove an entry or rotate sealed viewing keys. Joining-device public handoff and
  roster details stay with these controls.
- **Quick actions → Transfer permission:** choose 10/15/30 minutes and caps, authorize an expiring JubJub
  grant, lock the local key or revoke the grant. Choose the asset/recipient in
  **Passport account** first; Settings displays the draft target separately from recorded session scope, and the actual
  authorization still reviews its exact scope. Without an authenticated full owner, critical owner operations
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

### Read a session at a glance

**Settings → Quick actions** separates **Current session** from **Configure a new
session**. The status explains whether the local signer is ready, locked,
expired, pending or blocked. A recorded grant keeps its own asset, recipient and
spent/total limits; editing the withdrawal form changes only the next session's
draft target. NIGHT is named explicitly; other assets retain their token identity.
Limits are in smallest units, not whole NIGHT. Exact addresses, asset identifiers,
grant/intent/transaction IDs and the UTC deadline remain selectable under details.

**Lock on this device** immediately disposes the local key. **End on-chain
permission** requests revocation with fresh passkey consent and waits for chain
confirmation. A local countdown does not establish chain expiry or revocation.
Blocked outcomes retain the original intent and prohibit retry; consult Audit and
the operator reconciliation procedure. These are presentation changes, not new
authorization or recovery behavior.

Other Settings actions have separate cards and labeled controls. The external
Lace Wallet panel shows asset balances, a read timestamp and exact-identifier
details instead of a single address/balance paragraph. An unavailable read clears
the preceding snapshot; it never invents a zero balance.

Settings subpages keep unrelated controls out of view. Device/holder preparation mirrors
the explicit **Target Passport ACC address** used by Open by address; changing
that public input does not open, authorize or switch the active account. It is
disabled while an operation runs. A name lookup never fills it or a recipient.

## Progress and Activity

The weighted, staged progress bar, operation result and transient explanations
live together in **Activity → Current operation**. The selected workspace keeps
its task controls and balances; completed results never take over another workspace.
Time estimates stop below completion; unknown/unestimated progress is not a
confirmation percentage. Service/client clock differences are clamped for
presentation only; original events and IDs remain available in Audit.
Cancelled attempts and unknown outcomes never expose a completed 100-percent
progress value. A cancelled attempt does not imply that earlier effects rolled back.

Desktop has a collapsible right **Activity** panel: **Current operation** first,
then **Your journey**. It starts collapsed so idle Overview has no empty side
panel; its trigger sits alongside the workspace title. Each approved credential
call still reveals Activity before browser access. Starting any action reveals
desktop Activity. On mobile, an operation with no credential ceremony opens its
result sheet after completion or failure, including a session withdrawal or an
error before the first ceremony; it stays open until dismissed. Cancelled reviews
do not open another sheet. Progress can be opened using Activity while waiting.
These choices follow the actual lifecycle, not estimated passkey counts.
Its compact summary links to the matching Audit run. Audit
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
The native provider dialog follows only after explicit approval. Before each
credential call, the explanation is revealed in Activity and must be visible.
On mobile an automatically opened Activity sheet closes when the operation ends;
a sheet the user opened remains theirs to close. The blocking review dialog stays
separate and is never replaced by an Activity message. Cancelling an
attempt cannot undo earlier submissions. See [consent]({{ '/consent/' | relative_url }}).

## Uncertain results and evidence

An unknown funding/submission outcome keeps the original public request, flow or
intent references. A stopped/failed attempt is not proof of failed chain effects.
The summary asks for reconciliation and links to Audit; navigation never creates
a replacement request. A blocked session retains its original intent ID and reconciliation notice in
Activity. When the panel is collapsed, its trigger says **Needs attention**; the
underlying transaction fence remains enforced.

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


## Why passkey prompts differ from the upstream demo

See the [prompt comparison]({{ '/passkey-prompts/' | relative_url }}). Our default
P-256 owner signs individual circuit challenges in the authenticator; upstream
v5.2 derives a JubJub signer for one action. Reader PRF, wallet PRF, enrollment
compatibility and browser-profile retries are separate sources of requests.
Moving messages changes presentation, not the credential calls or their approvals.
