---
layout: default
title: Consent and passkey purposes
permalink: /consent/
---

This page separates the reusable [library ceremony contract]({{ '/library-guide/' | relative_url }})
from the [reference demo's host policy]({{ '/demo-guide/' | relative_url }}).
The hook is published in RC7; the combined app review and routine/full-owner/session
composition below describe later local source.

**Current local-source policy:** reviewed login may prepare a bounded routine
reader/wallet lease. Critical operations need fresh passkey approval even under
an unlocked JubJub full owner. This supersedes the older local policy that reused
that owner for administration without another request. The owner retains full
on-chain authority; fresh approval is host policy. These changes are not in RC7.

## RC7 increment and host responsibility

The optional `beforeCeremony` hook is published in `0.1.0-rc7`; it is absent from
RC6. Use matching RC7 packages and backend versions. Hosts retain their own consent
policy; installing the adapter does not supply an application transaction review.

There are two decisions: permission to use a key for a stated purpose, and approval
of the exact account operation. Identifying a passkey or deriving its PRF does not
by itself approve a withdrawal, enrollment, grant or independent HD wallet.

## Public ceremony hook

`webauthnPasskey`, `browserPasskey`, `passkeyPrf` and `passkeySeed` accept an optional
`beforeCeremony` callback. `createBrowserPassport` forwards it from its `passkey`
configuration. The callback runs **before** the actual credential API call; throwing
prevents that access. It receives frozen public metadata only:

```ts
import {
  webauthnPasskey,
  type BeforePasskeyCeremony,
} from '@input-output-hk/mn-passport-adapter-webauthn';

const beforeCeremony: BeforePasskeyCeremony = async (ceremony) => {
  // Bind this actual purpose to the captured operation in trusted host UI.
  // Review it here, or check an approval scoped to this exact call; throw on refusal.
  console.info(ceremony.purpose, ceremony.rpId, ceremony.attempt);
};

export const keys = webauthnPasskey({
  rpId: 'localhost',
  origin: 'http://localhost:5173',
  beforeCeremony,
});
```

The snippet is an observer, not a complete authorization policy. It intentionally
does not approve operations on a user's behalf. A production host must bind its
approval to the account, network, request and authority being used.

| Purpose | Meaning |
| --- | --- |
| `create` | Create a discoverable P-256 credential with PRF requested |
| `verify-created` | Check the new credential's signing/profile compatibility before account effects |
| `identify` | Select and verify a credential for this operation |
| `identify-and-unlock` | In one discoverable assertion, select/prove the credential and evaluate both existing Lace PRF salts for operation-local account keys |
| `derive-keys` | Evaluate PRF to derive local signing/reader/journal or independent wallet material |
| `sign` | Request a direct P-256 account-transaction signature |

`attempt` is one-based. A known browser-profile retry receives another notification;
signed bytes are never rewritten. A held create-time PRF result or an existing
nested PRF session does not emit a fictional new browser ceremony. Metadata contains
no credential ID, challenge, PRF output, seed, private signing key or signature.
The hook is optional for backward compatibility, and is not contract enforcement.

## Demo behavior

The source preview stages a frozen operation context before work; staging does not
approve a credential. At the **actual credential callback**, one keyboard-accessible
combined review presents the operation purpose, account/network, actual passkey
purpose/attempt and reviewed routine lifetime where applicable. Creation adds an
unchecked acknowledgement that the demo **permanently retires maintenance authority**,
preventing later ACC upgrades. Continue stays disabled until acknowledged.

Choose **Continue to passkey** to approve exactly that access, or **Cancel operation**
(or Escape) to refuse it. Cancel receives initial focus. Every later call and recognized
signing-format retry needs a fresh review and ceremony ID; an earlier successful prompt
or publication grants no approval to the next call. Ending the operation closes a pending
review. The captured account/lease is rechecked before review, after approval and after
the Activity rendering frames immediately before browser access.

The generic operation-only popup has been removed. Matching cached holdings reads and
built-in wallet connection use their already reviewed routine lease without that popup
or another credential request. Public state/roster/balance refresh, sponsor-wallet funding,
wallet refresh and external Lace connection need no Passport credential; their own
service/extension authorization still applies.

Provider sheets remain separate from app dialogs. The combined review is a **source
preview after RC7**: published RC7 has its earlier operation review/purpose banner, not
this UI composition. The public `beforeCeremony` contract itself remains optional and
host-owned. The operation log associates each actual approval/refusal with its public
ceremony and flow IDs and excludes key material and grant openings.

### Exact transfer and export approval

Owner unshielded withdrawal and sensitive grant-opening export now stage immutable
exact intent for the actual credential review. Transfer intent includes account,
network/binding, route/scheme, asset, amount, observed balance and the human recipient
plus its decoded bytes. Export binds the account and selected grant ID. Staging is
not approval, and preparation-only identification cannot authorize an effect.

The first actual `derive-keys` or `sign` review presents that intent alongside the
actual credential purpose. Continue approves both for this captured operation; each
subsequent credential call/retry still gets its own explicit review. The app checks
the approved transfer prefix and signer scheme immediately before its value POST,
and rechecks the selected export ID/account plus handoff network/binding before
showing the sensitive opening. Missing review, changed fields, expiry or replacement
refuses. The review is not a reusable next-credential token or a new signer permission.

A matching scoped JubJub grant transfer keeps its standalone exact decision because
it makes no native credential call. Other device/grant/rotation reviews remain where
their final data arrives later. Viewing access may precede exact mutation details,
as for rotation holdings or independent grant-holder identity. An approved read/unlock
never permits substituting another transaction. These source cases are tested by
[exact-review unit regressions](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-dapp/test/exact-review.test.ts);
combined browser journey receipts qualify their exercised compositions separately.

Login may separately approve a 10/15/30-minute routine memory lease of derived
reader/wallet material. It does not approve later critical work or retain a full owner.
A matching expressly approved bounded grant transfer retains its exact transfer review
and zero-new-credential path. Neither a stale lease nor an unknown outcome can silently
change that route.

Cancellation stops future work. It cannot undo already confirmed publications or
prove an uncertain submission never happened. Preserve original request IDs and
transaction receipts, inspect the log and reconcile before another effect.

## Prompt budgets and session lifetime

Current-source active-account login combines discovery and PRF into one
`identify-and-unlock` request. Both sequential sealed-key checks reuse that login's
held outputs; they are cleared on success or failure. P-256 ownership verifies the
actual signed bytes, including bounded extension data and additional JSON members.
JubJub has no enrolled P-256 public key: it authenticates the trusted provider's
PRF-derived key against the live JubJub entry and sealed reader instead. Both paths
validate the assertion's challenge, RP, origin and UV flags; no independent ES256
verification is claimed for the PRF-only JubJub path. The optional verified
`onAccountOpened` handoff runs inside this scope and can derive the routine wallet
seed without a second credential request. It exposes no owner PRF. Other hosts
must opt in; failed/stale adoption locks the demo's routine cache.
It does not relax `wa-json134` transaction signatures, enroll an owner, extend an
owner lease or remove either live key check. Unsupported PRF/cancellation does not
trigger another prompt. Pending setup may still need genuine signatures. See
[the comparison and evidence boundary]({{ '/passkey-prompts/' | relative_url }}).

Normal P-256 unshielded withdrawal uses one fresh `sign` request without an unused
PRF request: its browser key session owns the selected binding without loading keys
until needed. The core session/host guard still runs. Direct PRF sessions remain eager,
and a nested secret/journal read still obtains its own required PRF access. Neither
login assertions nor software ownership replace a strict transaction signature. See
[the source design and tests](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/research/2026-11-08-p256-sign-only.md).

P-256 signs each account transaction through its authenticator, so a multi-transaction
operation may need several prompts. JubJub signs in software after the approved PRF
unlock. Provider behavior, held create outputs and profile retries also affect
counts. The demo therefore explains purposes instead of promising a fixed count.
API assertions are not measured user-visible provider prompts.

Creation normally begins with two different accesses: `create` registers the
credential, then `verify-created` checks that its assertions match the ACC's strict
signing profile **before deployment**. PRF fallback or profile retries can add
requests. P-256 creation shares one post-registration PRF scope through setup, but
signs the sealed viewing-key inbox publications separately after activation
(reader envelopes and registrations). Each signature now
has its own numbered setup review. These are not repeated login or wallet-transfer
requests; the compatibility probe and signature checks remain enabled.

Declining a later setup signature does not remove the deployed ACC or an earlier
publication. Preserve the original account/operation evidence and use the original
passkey's reopen/reconciliation path; do not create a replacement account merely
because the final setup request was declined.

The WebAuthn adapter shares PRF outputs among nested/overlapping users of the same
selected adapter binding until its last owner exits, then clears its held buffers.
Ordinary eager and lazy key owners both prevent create/identify/login from replacing
the selection; an in-flight selector likewise prevents key-scope entry. Public binding
values are copies, and old identity callbacks cannot repin a later/live operation.
A failed load stays refused within its ownership epoch rather than silently prompting
again. A fresh explicitly initiated scope can retry after all owners exit. This is
**not** independent account/capability isolation for unrelated concurrent callers.
Hosts should not share that adapter across unrelated approved operations. Broader
session isolation and prompt-budget qualification remain
[#245](https://github.com/input-output-hk/midnight-passport-sdk/issues/245).
The optional `CredentialPort.withLoginSession` additionally fences overlapping
logins and creation in both directions. The durable wrapper explicitly forwards
that capability bound to its original receiver, including prototype methods.
P-256 address-first opening authenticates the sealed registration before adopting
the selected public key; it cannot rely on an earlier directory-based open.
The browser implementation clears login buffers
at callback completion even if a misbehaving host leaves a child unawaited, and
refuses late identification results. Captured ownership/selection checks also refuse
late paused credential access or signature completion after that login has ended. Hosts must await all work inside the callback.
Adapters without this optional port retain their existing login behavior.

For a cached full owner, the demo requests fresh credential-pinned PRF approval
before each critical reviewed operation, checks the derived owner and reader
against the captured lease, and preserves its original expiry. Internal recovery,
publication or mutation calls within that one operation share this approval.
Decline, mismatch or loss of the captured lease refuses without another signer
route or fallback. Public arguments are captured before async approval so the
approved recipient, amount, device or grant cannot change during the dialog.
Sensitive opening export and recovery/publication are critical even when a user
might perceive them as reads. A separately approved, capped grant transfer has its
own exact review and can use zero credential calls while inside that scope.

## Source preview: opt-in JubJub sessions

The local source after RC7 adds an explicitly approved, PRF-derived session child
with a recipient/asset-pinned, capped grant and a mandatory 10–30 minute chain
expiry (15 minutes by default). Eligible unshielded withdrawals retain exact
transfer consent and use JubJub without another passkey. Owner administration
and outside-scope owner transfers retain fresh passkey paths.
Wallet derivation may reuse a separately approved routine lease; a scoped grant
itself supplies no wallet or general reader authority.

Read the [session guide]({{ '/jubjub-sessions/' | relative_url }}) for setup,
authority rules, key derivation, locking/revocation, uncertainty handling and
evidence limits. Local disposal is not chain revocation; a child is not enrolled
as an unrestricted owner. This source capability is **absent from published RC7**.

See the [use-case evidence map]({{ '/use-case-coverage/' | relative_url }}) for what
the automated browser tests establish. Google/iCloud synchronization and restoration
remain independently qualified provider behavior.


The source follow-up moves transient explanations into **Activity → Current
operation**. The separate blocking dialog still requires approval. Activity is
revealed and scrolled to the explanation before the credential call; unavailable
or hidden explanations refuse the request. A collapsed trigger flags attention
without putting a large notification panel over another task. See
[prompt comparison]({{ '/passkey-prompts/' | relative_url }}).
