---
layout: default
title: Authenticated JubJub owner
permalink: /authenticated-owner/
---

**Local source preview, after RC7.** The owner-approved policy now allows an
authenticated JubJub owner to perform **all implemented account owner operations**.
Device changes, key rotation and permissions no longer force another passkey while
this explicit owner session is active. Exact operation reviews remain mandatory.
This supersedes the earlier critical-operation passkey policy for this mode.

## Try the demo

1. Create or open the existing ACC with its passkey.
2. Go to **Settings → Quick actions**. Select 10, 15 or 30 minutes, then
   **Unlock account** and approve the pinned passkey PRF ceremony.
3. For an existing P-256 account, review the public JubJub and reader keys before
   enabling the companion as a **full owner**. This one-time enrollment publishes
   sealed reader data and an owner entry; it needs existing-owner passkey signatures.
   It is not a grant. Declining the enrollment sends no enrollment transaction.
4. The app verifies the live owner entry and the unique sealed reader registration
   before declaring the account unlocked. Now transfers, enrollment/removal, viewing
   key rotation, grant issue/revocation and bookkeeping use this JubJub owner without
   another credential access. Ordinary operation reviews still name exact effects.
5. **Lock account keys**, hidden tab, page exit or timeout disposes local owner,
   reader and seed copies. Reauthenticate to reproduce the same owner key. An already
   live owner is verified again; it is not enrolled again on every unlock.

Existing JubJub-primary accounts already use this same PRF-derived owner recipe;
they do not need another JubJub owner entry. A P-256 companion has a separate
X25519 reader so one reader is not ambiguously registered against two authorisers.
Both owner types can enroll another P-256 or JubJub reader through their supported
owner APIs. This does not automatically enroll a P-256 key into a JubJub-primary ACC.

## Predictable derivation, secret input

The factory reuses the existing **Lace v1 recipe**, rather than inventing another
signing key namespace:

```text
PRF first salt  = SHA-256("lace-passport/prf/authoriser/v1")
JubJub scalar  = little_endian(first output) mod ACC subgroup order
JubJub public  = pinned_ACC_generator × scalar
```

The same passkey and PRF output produce the same signing pair on every unlock.
There is no random session ID in this owner derivation. Predictable means
reproducible with the secret PRF output, not guessable from a credential ID or public
key. This is a different authority model from the random-context scoped grant child.

PRF output two retains its existing wallet and reader recipe. The P-256 companion
reader is an SDK extension: MIP-0015 domain
`lace-passport:companion-reader:v1`, context `JSON.stringify([networkId, account])`.
The native JubJub reader keeps the existing `lace-passport:reader:v1` network
recipe. Neither changes the built-in wallet seed/address. The ACC viewing secret
remains random, sealed to readers; it is not the wallet seed or signing scalar.

## Authority and lifetime

| Action | Authenticated full owner | Reading-only / locked fallback |
| --- | --- | --- |
| Holdings and built-in wallet connection | Reuse unlocked reading/wallet material | Reading-only lease or fresh consented PRF |
| Owner transfer | JubJub owner and exact transfer review | Fresh owner passkey, or a separately approved matching grant |
| Device enrollment/removal, key rotation | JubJub owner and exact administration review | Fresh owner passkey |
| Grant issue, revoke, revoke-all, bookkeeping | JubJub owner and exact permission review | Fresh owner passkey/PRF |
| Creating another passkey or selecting a different grant holder | That identity still needs its own ceremony | Same |

**Local expiry is not on-chain expiry.** A full owner has the same contract power
as the original owner. A copied private owner key can remain usable until its
live entries are removed; a browser timer does not revoke it. Existing entry-removal,
survivor/rotation and compromised-key limitations still apply. This consent is shown
before enrollment. Wallet connection alone still grants no ACC authority.

The app retains only owned canonical scalar/seed copies in page memory. It clears
raw PRF outputs immediately, checks account/network/binding/credential scope and
absolute wall/monotonic expiry, and zeros owned copies on lock. JavaScript cannot
guarantee erasure of engine temporaries. Secrets do not enter storage, Audit or logs.
Public enrollment attempt IDs and transaction references persist for reconciliation.

An approved owner operation whose lease expires stops without silently switching to
P-256. A transaction already submitted may settle after local lock; keep its original
IDs. Public state/device/grant-roster reads remain available after lock for reconciliation.
Each acknowledged SDK submission emits `sponsor.submit` with its original transaction ID
before finality/composite completion. The demo retains these public references in separate
local records and restores them into Audit after reload. A submitted reference is not proof
of finality. Multi-transaction rotations can stop on expiry after earlier effects; inspect
the original IDs rather than replaying. Storage failure blocks further key actions and
asks you to copy Audit; records are never silently evicted. Companion enrollment records
also retain any earlier `rotationTxHash`.
The demo records completed owner receipts before its best-effort post-operation refresh; an indexer
failure cannot erase the transaction reference or trigger another submission.
Uncertain grants/transfers retain their existing fences. Shielded withdrawals
retain the exact-value guard; full ownership does not enable partial spends.

## Engineer integration

`keys.createAuthenticatedJubjubOwner` is framework-neutral. Give it the existing
PRF authoriser output, derived wallet seed, pinned pure circuits, account context,
and a host `check()` that enforces the authenticated lifetime and revision. The
caller clears raw inputs in `finally`; the returned object owns and clears its own
copies. It supplies `authoriser`, `prf`, `credentials`, `publicKey`, `readerPublicKey`,
`check()` and `dispose()`. Its credentials port represents already completed PRF
authentication; it cannot create a new credential.

Pass it as `BrowserPassportConfig.ownerSession`, with `arm: 'jubjub'`, to compose
the existing account API. Network and binding mismatches refuse. The composition
opens only the pinned account and refuses creation; it never invokes a credential
provider. Private derivation/read sessions recheck completion before exposing results;
owner mutation sessions retain acknowledgements after dispatch. Live ACC counter, device, keyring and coin checks remain in the account
package. Hosts must verify/enroll an owner before exposing this API to their UI.
The exported source alone does not prove that its public key is a live owner.

The browser composition checks the lease before handing work to the prover, sponsor,
submitter and host value-call port. Expiry during proving or sponsorship blocks the
next submission. A host value-call POST delegates proving/submission to the backend:
check before dispatch, then retain its acknowledgement even if the local key locks.
Do not discard a successful response or replay an uncertain request. Custom transports
with asynchronous preparation must recheck at their actual dispatch; direct users of
the key factory must wire this transport policy themselves. A signature already sent
to another process cannot be recalled by disposing the browser key.

The demo keeps owner counter records separate from the primary P-256 record and
preserves the original directory pointer. Encrypted grant journals keep the same
root-derived key; bookkeeping recovery can open seals addressed to either of this
passkey's original/companion readers. Partner apps need not adopt our UI or React.

First enrollment writes a public pending marker before changing chain state. An
uncertain attempt cannot be replaced automatically. A later live owner/keyring
verification can reconcile that same marker without another enrollment. If the
owner is still absent, inspect its original attempt and Audit; there is no automatic
replay or general-purpose partial-enrollment repair wizard in this preview.

## Evidence boundaries

Key tests use generated ACC pure circuits and verify real signatures, deterministic
identity, reader separation, context refusal and disposal. SDK tests exercise cached
owner opening, administration/value use, expiry refusal and mixed-curve enrollment
and rotation with fake chain drivers. Chromium journeys separately cover explicit
enrollment, prompt-free authenticated owner operations, stable reauthentication,
lease expiry and local lock using synthetic credentials/account/chain.

These are source checks, not new native-proof, real-provider, published-package or
full Lace acceptance. The companion reader namespace is not claimed as an upstream
Lace standard. Existing published RC7 behavior remains unchanged until release.

[Limited reading and grants]({{ '/quick-actions/' | relative_url }}),
[passkey purposes]({{ '/passkey-prompts/' | relative_url }}),
[demo workspaces]({{ '/demo-ui/' | relative_url }}).
