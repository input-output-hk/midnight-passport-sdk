---
layout: default
title: Understanding passkey requests
permalink: /passkey-prompts/
---

**Source preview after RC7.** Login and critical operations require passkey access.
Routine work can reuse a reviewed memory lease. This supersedes the earlier local
policy that allowed full-owner administration without fresh approval. Published
RC7 and historical qualification receipts are unchanged.

The [demo app]({{ '/demo-guide/' | relative_url }}) uses one combined operation/purpose
review for each actual credential API call, including retries. An exact transaction,
device or grant review may still be separate. The password manager's credential sheet
is another event. Count actual credential calls separately from app dialogs and provider
sheets/touches. The [library hook]({{ '/consent/#public-ceremony-hook' | relative_url }})
provides metadata and refusal; it does not impose this demo UI on other hosts.

## Login also prepares routine access

**Log in** and **Open by ACC address** use one discoverable, user-verified assertion
with both unchanged Lace PRF salts. Identification and both live sealed-key checks
reuse its operation-local outputs. P-256 verifies the actual assertion signature;
JubJub matches the trusted provider's PRF-derived key to its live owner entry and
sealed reader. JubJub has no enrolled P-256 key and does not claim independent
ES256 verification. Both paths check challenge, RP, origin and UV.

The demo's login review includes a **10, 15 or 30 minute routine lifetime**. After
verified opening, its `onAccountOpened` callback uses
`BrowserLoginKeys.deriveWalletSeed()` inside the same PRF scope to adopt derived
wallet seed and reader material in memory. Raw PRF outputs are cleared when login
ends. This does not cache an owner key, enroll/unlock a companion, connect a wallet
or approve a transaction. Other SDK hosts must explicitly opt into this handoff.

Cancellation, missing PRF, failed ownership or stale/failed adoption does not trigger
another request or a fallback seed. Hidden tab, page exit, local lock and expiry
invalidate routine access. Repeated holdings reads and built-in wallet connection
within that approved lease need **no new credential request**. Wallet balance
refresh uses the already connected wallet and needs no Passport passkey either.

After lock/expiry, explicitly approving holdings or built-in wallet connection can
reauthenticate once with the pinned credential **and prepare a new routine lease**.
The reviewed lifetime is captured before consent. Following routine actions use
that lease without more requests. If an existing lease was selected for an action
and expires before the captured action completes, that action refuses; it does not
silently switch to this reauthentication path. Matching cached reads/wallet access have
no generic operation modal. The lifetime is shown in the actual login/unlock review.

Cold P-256 address recovery is tested as the **first open on a fresh adapter**.
It recovers the public key/policy from an authentic sealed registration, verifies
the same login assertion, then checks the live entry/keyring. Earlier tests that
opened through the directory first could hide a missing preloaded-key defect.
An absent/ambiguous registration, wrong signature or removed owner refuses.
This cannot recover a lost credential or discover an unknown ACC address.

## Request paths

| Action | Current source credential path |
| --- | --- |
| Create account | Register, then the strict new-credential compatibility probe. P-256 creation shares one post-registration PRF scope across setup; it reuses both create-time outputs or makes one fallback PRF request. Actual setup signatures remain separate. |
| Open an active account, either arm | One combined `identify-and-unlock` request; routine adoption within that scope adds no request. Unfinished activation/publication may still need real signatures. |
| Public state, balances and rosters; funding; external Lace connection | No Passport credential request. Funding has its own service authorization; Lace has its own extension consent. |
| Private holdings / built-in wallet connection | Zero requests with the matching approved routine lease; otherwise an explicitly consented PRF path. An expired captured lease refuses without silently changing routes. |
| Wallet connection without an ACC | One discoverable PRF request selects that wallet identity and derives its seed. It does not reuse an unrelated logged-in owner or start a routine cache automatically. |
| Independent grant-holder spend | One combined discovery/PRF request for the holder, plus exact grant/transfer review. The holder must match the approved grant; it is not implicitly the ACC owner. |
| Critical operation with the primary owner | Fresh PRF/signing access under the existing owner arm. P-256 requires a real signature for every gated circuit. |
| Critical operation with an unlocked JubJub full owner | Fresh credential-pinned PRF approval, matching its derived owner and reader to the captured session. One approval covers that reviewed logical operation's internal calls; it does not extend the lease. |
| Separately approved capped grant transfer | Zero further credential requests inside its recipient, asset, amount, aggregate cap and expiry. Outside scope refuses; no automatic owner fallback. |
| Known P-256 format retry | A fresh assertion, at most five attempts, each separately reviewed. Signed bytes are never rewritten. |

Critical operations include owner transfers, device enrollment/removal, viewing-key
rotation, grant issue/revoke/revoke-all, sensitive grant-opening export and pending
opening recovery/publication. Public roster inspection is not grant recovery.
An unlocked JubJub owner remains a **full on-chain owner**: fresh approval is the
demo host's policy, not a contract spending restriction.

## Why P-256 can still ask several times

The default P-256 private key remains in the authenticator. Login or PRF cannot
produce its next exact ACC challenge signature. Creating a P-256 ACC includes two
separately signed sealed-inbox publications; deployment's ten waves are not ten
passkey requests. A multi-transaction mutation can require several signatures.

PRF-bearing assertions may contain extension data. They cannot replace the pinned
`wa-json134` compatibility probe or transaction signatures. Flexible local login
verification does not relax that contract profile. Shared credential creation still
performs the P-256 probe even for a JubJub-primary account; eliminating that work
needs a separately designed and qualified creation path.

## Upstream comparison and evidence

Upstream v5.2 source pinned at
[`d343acf6674b7258e04cad9eb5d64c054f0dfebd`](https://github.com/midnightntwrk/passport-demo/tree/d343acf6674b7258e04cad9eb5d64c054f0dfebd)
uses a PRF-derived JubJub
[`passkeyCustodyDevice`](https://github.com/midnightntwrk/passport-demo/blob/d343acf6674b7258e04cad9eb5d64c054f0dfebd/examples/passport-demo/src/identity/passkeyCustody.ts)
for an action's transactions, then forgets it. Its
[`discover()`](https://github.com/midnightntwrk/passport-demo/blob/d343acf6674b7258e04cad9eb5d64c054f0dfebd/demo-backend/src/passkey.ts#L1148-L1181)
combines discovery and PRF. These are pinned source observations, not measured
staging/provider prompt counts. Our local login follows that combined pattern
while preserving the existing derivation, ownership and sealed-reader checks.

The [credential-path audit](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/review/credential-policy/README.md) maps source paths and
regressions, including creation, address-first recovery, optional handoff, durable
wrappers, independent identities and critical approval. It does not claim every
provider/circuit/interleaving was exercised. Actual Google/iCloud restoration,
native combined browser flows and pure-JubJub creation optimization remain separate.

[Routine access]({{ '/quick-actions/' | relative_url }}),
[full-owner authority]({{ '/authenticated-owner/' | relative_url }}),
[consent]({{ '/consent/' | relative_url }}).
