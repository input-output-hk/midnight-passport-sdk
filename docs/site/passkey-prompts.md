---
layout: default
title: Understanding passkey requests
permalink: /passkey-prompts/
---
**Updated local-source policy:** [Unlock account]({{ '/authenticated-owner/' | relative_url }})
authenticates a deterministic JubJub **full owner** for all implemented owner operations.
That mode does not require a fresh passkey for administration or permission changes.
The older reading-only/scoped-session mode below retains its passkey fallback; its
child key is not a full owner. Operation reviews, local expiry and unknown-intent
fences remain. These additions are not in published RC7.



**Source preview after RC7.** A review dialog in our app and the password manager's
credential sheet are different events. The operation review authorizes a stated
flow. Each subsequent request also has its own explicit review. Those dialogs do
not themselves call WebAuthn; counts should come from credential API accesses,
purpose/attempt traces and the provider, not the number of explanation panels.

## Why our default can ask more often

The demo defaults to **P-256**. The authenticator holds that owner private key and
signs the exact challenge for each authorized circuit. A prior login or PRF
unlock cannot produce the next P-256 transaction signature. A multi-transaction
operation can therefore require several native approvals.

The upstream **v5.2 source**, pinned at
[`d343acf6674b7258e04cad9eb5d64c054f0dfebd`](https://github.com/midnightntwrk/passport-demo/tree/d343acf6674b7258e04cad9eb5d64c054f0dfebd),
uses a different passkey custody path:
[`passkeyCustodyDevice`](https://github.com/midnightntwrk/passport-demo/blob/d343acf6674b7258e04cad9eb5d64c054f0dfebd/examples/passport-demo/src/identity/passkeyCustody.ts)
accepts a root derived by a user-verified assertion, constructs a **JubJub** signer,
reuses it for that action's transactions/retries/backfill, then forgets it.
The upstream ordinary wallet session also has its own
[presence check](https://github.com/midnightntwrk/passport-demo/blob/d343acf6674b7258e04cad9eb5d64c054f0dfebd/examples/passport-demo/src/lib/passkeyPresence.ts).
This is source evidence, not a measured live staging journey or proof of the
current staging build's exact behavior. Earlier managed-signing plans do not
establish what this source does.

## One request for active-account login (local source)

**Log in** and **Open by ACC address** now use one discoverable, user-verified
assertion with both existing Lace PRF salts. The same assertion identifies the
credential and supplies operation-local keys for both sealed-key checks. Previously
the P-256 path identified the credential, then separately unlocked PRF twice: three
credential requests. JubJub also had a separate identify/unlock pair.

This follows upstream's
[`WebAuthnPrfKeyProvider.discover()`](https://github.com/midnightntwrk/passport-demo/blob/d343acf6674b7258e04cad9eb5d64c054f0dfebd/demo-backend/src/passkey.ts#L1148-L1181)
pattern: request discovery and PRF together. Our Lace salts, derivation recipe,
account ownership and live sealed-key checks are preserved. P-256 uses `owns()` to
verify the original assertion signature against the enrolled P-256 public key.
JubJub accounts have no enrolled P-256 verification key: they authenticate with the
trusted WebAuthn provider's PRF-derived JubJub key, its matching live ACC entry and
the sealed reader. Their login does not claim independent ES256 verification.
Both paths validate challenge, RP, origin and UV flags. Extra client JSON members
and bounded authenticator extension data are accepted locally; the stricter ACC
transaction profile is unchanged.

The request review says `identify-and-unlock`. Cancel or missing PRF fails without
an automatic second request or replacement seed. Held output copies are zeroed
when login finishes or fails. Login does not enroll a JubJub companion, start a
10–30 minute owner session, connect a wallet or authorize a later transaction.
Use **Unlock account** separately for that explicitly approved owner session.

The one-request regression covers already active accounts under both owner arms,
including known-address opening. Resuming unfinished activation/publications can
still require actual transaction signatures. A credential API call is not a
guarantee about how many sheets or touches a particular provider shows; live
provider qualification remains separate. Published RC7 does not include this fix.

## Sources of separate requests in our demo

| Purpose | Why it can add a native request |
| --- | --- |
| Create | Register the credential, then verify its P-256 compatibility before any deployment. Creating a credential alone does not prove it returns the fixed ACC assertion format. |
| Reader/key unlock | PRF derives local keys. Creation reuses returned PRF outputs once when both salts are available; otherwise it asks separately. Short-lived operation key sessions are cleared afterward. |
| P-256 owner signature | Each circuit challenge needs a fresh authenticator signature. Initial sealed viewing-key publications are separate signed calls, not repeated logins. The ten deployment waves are not ten passkey requests. |
| Open an active account | One combined discovery/PRF request for both P-256 and JubJub in the current browser adapter. All ownership, live entry and sealed-key checks remain. |
| Connect built-in wallet | Derive its separate HD seed through PRF: one request when pinned to the open account's credential; without an open account there is also a picker. Balance refresh reuses the connected wallet and requires no passkey. |
| Known browser-format retry | Chrome can add an extra signed JSON member that the pinned `wa-json134` contract cannot accept. The adapter requests a fresh assertion, at most five attempts, with a new explanation/approval for each retry. Signed bytes are never rewritten. |
| Scoped session | Authorizing the PRF-derived JubJub child and issuing its bounded grant can need multiple ceremonies. Later matching transfers use that child; it does not acquire owner or general reader privileges. |

The SDK also supports JubJub owners. Account creation and enrollment still share
parts of the credential adapter with P-256, so selecting JubJub does not guarantee
the upstream's creation count. Existing account authority is not changed by a UI
setting. An explicitly unlocked full owner can reuse JubJub; a scoped spending
session is not general authority to use owner or HD wallet secrets.

PRF-bearing assertions may carry extension data. Our pinned P-256 circuit accepts
only its bounded authentication-data/profile shape, so combining PRF and a P-256
ACC transaction signature is not a safe shortcut under this binding.

## Improvement candidates

Measure each real provider/action first, retaining public purpose/attempt counts
and transaction IDs without credentials or secrets. Review unnecessary P-256
compatibility work on a pure JubJub creation path. Combined active-account login,
creation PRF reuse and wallet balance refresh already avoid requests. Reducing requests
must not silently cache an owner key for a spending session, skip transaction
consent, relax wrong-passkey checks or rewrite authenticator-signed data.

The current source also has explicit [quick actions]({{ '/quick-actions/' | relative_url }}).
One pinned PRF unlock keeps routine reader/wallet material in memory for the
chosen 10–30 minutes. Repeated holdings reads and wallet connections use no new
credential request while it is active. Scoped transfer keys can be derived from
that session, but issuing/revoking their permission remains a critical fresh-owner
operation. Initial creation, unfinished setup and multi-transaction owner changes can still
need several requests; this does not promise full upstream/provider parity.

[Consent]({{ '/consent/' | relative_url }}),
[session boundaries]({{ '/jubjub-sessions/' | relative_url }}),
[demo workspaces]({{ '/demo-ui/' | relative_url }}).
