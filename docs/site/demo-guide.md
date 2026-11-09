---
layout: default
title: Reference demo app guide
permalink: /demo-guide/
---

The reference app shows one way to compose Passport accounts, local services, passkeys
and a separate read-only wallet. Its UI, local journals, routine memory leases and
funding setup belong to the demo. To integrate the packages into your own product,
start with the [Library integration guide]({{ '/library-guide/' | relative_url }}) and
[public runtime/export index]({{ '/packages/#runtime-and-host-requirements' | relative_url }}).
The [complete caller example]({{ '/getting-started/#4-compose-the-browser-account-api' | relative_url }})
uses injected API/presentation capabilities; it does not require this app's DOM,
Web Locks, storage names or routine-owner composition.

**Version:** the base walkthrough describes the RC8 reference app.
Sections labeled **Source preview** require later source; use the
[unreleased change map]({{ '/source-preview/' | relative_url }}) before comparing behavior. Installing library packages
does not install a demo UI or enable its memory/session policies. A published
package, a deployed documentation site and a source checkout have separate versions.

## Run the local composition

Follow the developer [app setup and configuration reference](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/README.md).
The demo needs Nix, the pinned ACC/compiler artifacts, a ready local chain/prover and
configured service wallets. TypeScript package installation alone cannot deploy an ACC.
Reuse a healthy existing stack and its canonical passkey origin; preserve original
network, journals and unknown IDs when investigating a failure.

The browser runs at `http://localhost:5173`. The Passport, key and optional funding
services normally use `8787`, `8788` and `8789`. The optional funding wallet supplies
allowlisted ACC deposits; the fee sponsor and the user's built-in wallet are separate.
Use the [demo use cases]({{ '/use-cases/' | relative_url }}) for action prerequisites and
[historical RC5 funding trace]({{ '/handover/' | relative_url }}) for that dated evidence.
Use the app setup reference above for prerequisites and state preservation.

### Launcher workflow

From a source checkout, use these separate stages after preparing the prerequisites
and matching ACC export described in the app reference:

```sh
nix develop -c pnpm demo check
nix develop -c pnpm demo up
```

`check` checks tools, Docker memory and required ports; it does not prepare missing
artifacts. `up` starts the configured reference services and keeps its
launcher-owned processes in the foreground. Occupied application ports refuse;
if a matching demo is already running, open it instead of launching a second one. For optional deposits, configure the funding wallet, private token and
asset policy first, then use `nix develop -c pnpm demo up --funding`. The wallet
must hold each asset on that chain. See the
[funding operations guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-funding-service/README.md).
Do not run a second wallet on occupied ports or delete existing state to repair a
restart. An existing configured demo may already be ready to use.

## Enter and navigate

The signed-out entry offers **Sign up**, **Log in** and account-address login. It has
no Overview menu. **Demo tools** opens Audit or Settings without authentication.
After verified creation/opening, the app shows **Passport account → Balances**.

Four workspace groups remain: **Passport account**, **Midnight wallet**, **Audit** and
**Settings**. The header's **Midnight Passport home** link returns to login before an
account has been opened in that page; after a verified open, it returns to Balances.
This navigation starts no credential operation and does not log out or clear records.
Stored hints or public deep links do not authenticate an account.

On smaller screens, **Menu** opens the same navigation in a focus-contained drawer.
**Activity** owns progress, results and purpose explanations; Audit retains public
operation evidence, including cancelled and unknown outcomes. See
[demo navigation]({{ '/demo-ui/' | relative_url }}) for the actual pages and controls.

## Approve the access actually requested

The first actual credential request has **one combined app review**: operation purpose,
account/network, actual passkey purpose and the selected lifetime where relevant.
**Continue to passkey** approves that call; Cancel/Escape refuses it. Creation also
requires an explicit acknowledgement that the demo permanently retires maintenance
authority, so the ACC cannot be upgraded. Every later credential call or recognized
signing-format retry needs a fresh review. Provider-controlled sheets follow separately.

For **owner unshielded withdrawal** and **sensitive grant-opening export**, immutable
exact intent is now included in that actual credential review. The transfer names
account/network/binding, signer route/scheme, asset, amount, observed balance and both
human and decoded recipient. Export names the selected account and grant. Staging
those fields is not approval. Only a positive actual `derive-keys` or `sign` review
approves the captured intent; the app checks it again immediately before the value
POST or before showing the grant handoff. A changed/stale intent refuses without a
signer fallback.

Normal P-256 unshielded withdrawal now needs one fresh strict `sign` request and
has no unused PRF request. JubJub owner access uses its required PRF path; profile
retries or multi-transaction work can still need additional credential reviews.
Matching bounded-grant transfers keep their standalone exact decision and zero
native credential calls. Device, grant-issue/revoke and other administration reviews
can still be separate, and some exact fields require preparatory reader access.
See [consent]({{ '/consent/' | relative_url }}) and
[request paths]({{ '/passkey-prompts/' | relative_url }}). This is the implemented
source contract; source unit evidence and the combined browser receipt are separate.

## Understand the three local authority choices

| Choice | Retained authority | Next action |
| --- | --- | --- |
| Verified login / routine unlock | Derived reader and wallet seed material in page memory for the reviewed 10, 15 or 30 minutes; no full-owner key | Matching holdings reads and built-in wallet connection reuse it without a generic modal or new credential call. |
| Explicit full-owner unlock | The deterministic enrolled JubJub full owner, with a checked local lifetime | Critical owner transfers, device/key/grant changes and sensitive export/recovery still need fresh account-passkey approval. Local expiry does not remove its on-chain ownership. |
| Separately approved bounded transfer permission | A separate PRF-derived grant child, exact recipient/asset/caps and chain expiry | Matching transfers retain exact transfer consent and need no new passkey. Unknown or stale scope cannot silently fall back to an owner send. |

Login never automatically enrolls/unlocks the full owner, connects a wallet or issues a
grant. Other SDK hosts must opt into verified-login adoption and implement their own
custody/lifetime policy. Read [routine access]({{ '/quick-actions/' | relative_url }}),
[owner authentication]({{ '/authenticated-owner/' | relative_url }}) and
[bounded sessions]({{ '/jubjub-sessions/' | relative_url }}) before trying these controls.

## Remembered state and restoration

A remembered address is public metadata, not an authenticated private session. This
source demo keeps routine/owner keys in memory and does not silently restore them from
storage. A running wallet has a separate lifecycle; locking the routine cache does not
claim to disconnect that wallet or erase all of its internal state.

The [upstream restoration research](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/research/2026-11-08-session-restoration.md)
explains why another demo can restore a wallet without a new passkey: its storage retains
both encrypted wallet seed and a usable decrypt key. That observation is not a change to
this demo's consent/custody policy or evidence of fresh ACC authentication.

## Built-in wallet worker

This demo explicitly creates a dedicated module Worker through
`adapter-browser/background`; importing the account library does not start one.
The page retains passkeys and blocking review. The worker hosts wallet/HD derivation,
subscriptions and dust synchronization, with an allowlist of read methods. The page
validates unknown replies before rendering and ignores completions after stop or
scope replacement. NIGHT and DUST have separate progress/status; unavailable DUST
does not turn NIGHT into zero.

The demo selects a **150,000 ms** client timeout for wallet requests, overriding the
library's **120,000 ms** default, and retains the default **16** pending requests.
Initialization sends an owned seed copy, clears that copy in `finally` and clears
the received worker copy after initialization. Failure closes the owned client;
wallet stop invalidates later reads and terminates its worker. That does not claim
secure erasure of all wallet-runtime internals. A running wallet's lifetime remains
separate from the routine reader/seed lease; locking that lease alone is not wallet
shutdown. Node qualification probes use the runtime directly without this browser
worker. See the [background guide]({{ '/background/' | relative_url }}) for the
reusable transport, timeout and server-stop contracts.

The local demo also chooses remote service ports and independently pinned checked
configuration. Its localhost endpoints and wallet timeout are application settings,
not library defaults. Use [checked configuration]({{ '/api/#source-preview-checked-configuration-contract' | relative_url }})
when composing another host. No background timeout authorizes a transaction retry.

## Cancel, lock and investigate

Lock, hidden tab, page exit and expiry dispose the applicable local keys. Local disposal
does not revoke a chain grant, erase earlier plaintext or stop a submitted transaction.
Use explicit revocation when required and reconcile unknown transactions using their
original IDs. Do not delete local journals, clear site data or create a replacement
account/intent to get past an uncertainty fence.

Keep unavailable/stale balances distinct from zero. Amounts use smallest units.
Public balance/roster reads, refresh of an already connected wallet, funding and
external Lace connection need no Passport credential, while their own service or
extension authorization still applies. The built-in wallet remains separate from
ACC ownership and the sponsor/funding wallets.

The isolated [browser journeys](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-dapp/e2e/demo-journeys.e2e.ts)
use Chromium, mock credentials and synthetic account/chain/funding/wallet drivers.
The [consent contract tests](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-dapp/test/consent-approval.test.ts)
exercise the combined-review guard and lifecycle checks. These test sources are not a
claim that every current source revision has a passing receipt. They do not establish
Google/iCloud restoration, native proof/provider acceptance or full Lace support.
Use the [evidence map]({{ '/use-case-coverage/' | relative_url }}) and
[qualification limits]({{ '/qualification/' | relative_url }}) for recorded results.

## Source preview: signing comparison (after RC8)

For the local signing-mode comparison, open `?signing=passkey` or `?signing=jubjub`
on the demo origin. The latter creates a JubJub-primary account from the passkey PRF;
it does not enroll a companion on an existing account. Both retain login and fresh
critical approval. Sign-up explicitly reviews its routine reader/wallet lease and
shares confirmed setup's key scope. See [request paths]({{ '/passkey-prompts/' | relative_url }}).

## Source preview: deposit availability (after RC8)

The later reference source checks the funding wallet's current spendable unshielded inventory.
An empty asset or unavailable wallet disables that deposit option. The policy list remains
available for ACC balances and withdrawals. Allowlisting a test-token ID does not create tokens;
the funding wallet must hold that asset on the same chain. Refreshing ACC state also refreshes
this advisory availability; the backend checks again inside the deposit queue.
The funding service waits up to five seconds for unshielded catch-up after a confirmed deposit.
It refuses a longer synchronization gap without using a stale balance or retrying a transfer.
The demo proxy allows seven seconds for that read, including transport overhead.
Run both services from matching source and policy; refreshing the page alone cannot update them.

A proved inventory refusal says **No transfer was started**. Only an exact server receipt,
after a durable no-submit marker and request tombstone, lets the page forget that request ID.
A later explicit click starts a new intent. Uncertain/legacy requests retain their original IDs
and reconciliation requirement. No automatic retry or mint is added. This is later source
behavior, not a change to the published RC8 runtime.

The source-preview reference policy admits 1–64 distinct assets consistently in both services
and the browser. Older balance responses, including failures, cannot overwrite a newer read
or a reopened account’s availability. Inventory reads remain bounded even when subscription
teardown throws.

An unavailable selected deposit asset stays selected with funding disabled; refresh never
switches it to another asset. A current availability-read failure also disables deposits
until a successful refresh, preserving the asset list and withdrawal choices.

### Repeat a deposit without reloading

After confirmation, the source demo makes up to three GET observations when wallet
availability is temporarily unknown, with one- and two-second pauses. Each read
has a 45-second deadline including decoding. It never retries the deposit.
Known insufficient stock is not polled; failed or malformed reads disable funding.

Use **Deposit → Refresh availability** to check again after the bounded checks end
or a service read fails. It uses the public ACC refresh action, needs no passkey
and preserves your selected token. An unknown deposit retains its original ID
regardless of availability recovery. Navigation, cancellation and refresh do not
resolve that transfer; reconcile it separately in Audit.
