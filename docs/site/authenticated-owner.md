---
layout: default
title: Authenticated JubJub owner
permalink: /authenticated-owner/
---

The [demo guide]({{ '/demo-guide/' | relative_url }}) explains the UI steps.
[Library integration]({{ '/library-guide/' | relative_url }}) explains how a different
host supplies its own authentication, consent, custody and cleanup policy.

**Local source preview, after RC7.** An enrolled JubJub owner has full contract
authority. The demo now requires **fresh passkey approval for each critical
operation**, even while its explicit owner session is active. This host policy
supersedes the earlier all-owner-operations reuse behavior; it does not narrow the
owner's on-chain authority. Exact operation reviews remain mandatory.

Reviewed login prepares only routine reader/wallet material. It does not unlock or
enroll this full owner. Use [routine access]({{ '/quick-actions/' | relative_url }})
for holdings and built-in wallet connection without extra requests during that lease.

## Try the demo

1. Create or open the existing ACC with its passkey.
2. Go to **Settings → Quick actions**. Select 10, 15 or 30 minutes, then
   **Unlock account** and approve its combined operation/passkey PRF review.
3. For an existing P-256 account, review the public JubJub and reader keys before
   enabling the companion as a **full owner**. This one-time enrollment publishes
   sealed reader data and an owner entry; it needs existing-owner passkey signatures.
   It is not a grant. Declining the enrollment sends no enrollment transaction.
4. The app verifies the live owner entry and the unique sealed reader registration
   before declaring the account unlocked. Transfers, enrollment/removal, viewing-key
   rotation, grant changes, sensitive opening export and recovery/publication each
   require fresh credential-pinned PRF approval before using this owner. The derived
   owner **and reader** must match the captured session. Internal calls in the same
   reviewed operation share that one approval, never another operation's approval.
   The original absolute lease is not extended. Owner unshielded transfer and sensitive
   grant export include their immutable exact fields in the actual credential review;
   the app rechecks them before the value POST or handoff display. Other exact
   administration reviews can remain separate.
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
| Owner transfer | Fresh pinned passkey approval, JubJub owner and exact review | Fresh owner passkey, or a separately approved matching grant |
| Device enrollment/removal, key rotation | Fresh pinned approval and exact administration review | Fresh owner passkey |
| Grant issue/revoke/revoke-all, sensitive opening export, recovery/publication | Fresh pinned approval and exact permission review | Fresh owner passkey/PRF |
| Matching separately approved capped grant transfer | Grant child; no further passkey inside its exact bounds | Same, while that independently approved session is valid |
| Public state/rosters, wallet refresh, funding, Lace connection | No Passport passkey | Same |
| Creating another passkey or selecting a different grant holder | That identity still needs its own ceremony | Same |

**Local expiry is not on-chain expiry.** A full owner has the same contract power
as the original owner. A copied private owner key can remain usable until its
live entries are removed; a browser timer does not revoke it. Existing entry-removal,
survivor/rotation and compromised-key limitations still apply. This consent is shown
before enrollment. Wallet connection alone still grants no ACC authority.

The explicit full-owner cache retains owned canonical scalar/seed copies in page
memory; the separate routine cache retains no owner key. It clears
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
asks you to copy Audit; records are never silently evicted. Local lock and public
wallet refresh remain available without a receipt write. Independent cleanup and
receipt capture cannot be interrupted by a failing UI observer; unreadable session
checkpoints dispose the local signer and retain a blocked state. Companion enrollment records
also retain any earlier `rotationTxHash`.
The demo records completed owner receipts before its best-effort post-operation refresh; an indexer
failure cannot erase the transaction reference or trigger another submission.
Uncertain grants/transfers retain their existing fences. Shielded withdrawals
retain the exact-value guard; full ownership does not enable partial spends.

## Primary P-256 transfer remains a separate route

A P-256 owner unshielded withdrawal now normally obtains one fresh strict transaction
signature without an unused PRF request. That is a browser-adapter session optimization;
it does not unlock a JubJub owner or weaken the demo's fresh approval rule. The core
session descriptor/host guard still runs, PRF-dependent private/journal flows keep their
key access, and format retries get fresh approval. In-scope grant transfers remain the
separate zero-request route. See [request paths]({{ '/passkey-prompts/' | relative_url }}).

## Engineer integration

**Source-only reusable helper.** `createAuthenticatedJubjubOwner` from
`mn-passport-keys` is framework-neutral. It is absent from published RC7. Give it the existing
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
The low-level key factory does not perform WebAuthn access for each signature.
Fresh approval is host policy, not a factory default: the demo wires the optional authenticated-operation
hook of `routeAuthenticatedAccount`, snapshots public arguments before awaiting
approval, and rechecks the selected account/lease afterward. Its critical guard
requests a pinned PRF assertion and matches owner/reader without replacing the
lease. Sensitive export/recovery actions also enter that same reviewed guard.
A partner using the raw factory or another facade must provide its own equivalent
policy. A copied full-owner scalar is not constrained by this browser guard.

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
and rotation with fake chain drivers. Earlier Chromium receipts for prompt-free
owner administration describe the superseded policy, not the current fresh-approval
requirement. Current regressions separately exercise owner/reader matching,
refusal/expiry during approval, exact argument capture, lease preservation and
routine login adoption. Browser journeys use synthetic credentials/account/chain;
see the [credential audit ledger](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/review/credential-policy/README.md) for the test map.

These are source checks, not new native-proof, real-provider, published-package or
full Lace acceptance. The companion reader namespace is not claimed as an upstream
Lace standard. Existing published RC7 behavior remains unchanged until release.

[Limited reading and grants]({{ '/quick-actions/' | relative_url }}),
[passkey purposes]({{ '/passkey-prompts/' | relative_url }}),
[demo workspaces]({{ '/demo-ui/' | relative_url }}).
