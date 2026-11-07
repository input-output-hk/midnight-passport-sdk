---
layout: default
title: Consent and passkey purposes
permalink: /consent/
---
**Updated local-source policy:** [Unlock account]({{ '/authenticated-owner/' | relative_url }})
authenticates a deterministic JubJub **full owner** for all implemented owner operations.
That mode does not require a fresh passkey for administration or permission changes.
The older reading-only/scoped-session mode below retains its passkey fallback; its
child key is not a full owner. Operation reviews, local expiry and unknown-intent
fences remain. These additions are not in published RC7.



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
  // The host must already have approved this operation and own its session policy.
  // Show the purpose in the trusted host UI; throw if approval ended or changed.
  console.info(ceremony.purpose, ceremony.rpId, ceremony.attempt);
};

const keys = webauthnPasskey({
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

Every key-using demo action starts with a keyboard-accessible operation review.
Creation additionally requires an unchecked acknowledgement that the demo
**permanently retires maintenance authority**, preventing later ACC upgrades.
Declining this review invokes neither the action handler nor passkey access.
Public state/roster/balance refresh and sponsor-wallet funding do not acquire a
passkey approval. They cannot use the demo's ceremony guard as implicit approval.

The source preview after RC7 waits at a separate, keyboard-accessible **passkey
request review** before **every** credential API call, including profile retries.
Choose **Continue to passkey** to open the password manager or **Cancel operation**
(or Escape) to refuse this access. The cancel button receives initial focus.
An operation review, earlier successful prompt or signed publication cannot approve
the next request. Ending the operation closes a pending request review. The purpose
explanation in Activity alone is not consent. Published RC7 has the operation review and purpose
banner; this stronger request-by-request policy and Activity placement are source-preview changes.

The review identifies the operation, network, owner arm, account-selection context,
request number and purpose. A known browser-profile retry explains why a new
assertion is needed. Provider-controlled passkey dialogs remain unchanged. The
operation log links each request's approval or refusal to its own public ceremony
ID and the operation's flow ID; it excludes key material and grant openings.
Approval ends when that action finishes or fails, rather than staying active after
login.

Some preparations need viewing access before exact transaction details are known:
rotation inspects encrypted holdings, and grant use identifies/unlocks its holder.
The first review explains that access. The later transaction/device/grant dialog
still reviews the exact live scope, recipient, amount or reader fingerprint before
signing. An approved unlock is not permission to substitute another operation.

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
verification is claimed for the PRF-only JubJub path.
It does not relax `wa-json134` transaction signatures, enroll an owner, extend an
owner lease or remove either live key check. Unsupported PRF/cancellation does not
trigger another prompt. Pending setup may still need genuine signatures. See
[the comparison and evidence boundary]({{ '/passkey-prompts/' | relative_url }}).

P-256 signs each account transaction through its authenticator, so a multi-transaction
operation may need several prompts. JubJub signs in software after the approved PRF
unlock. Provider behavior, held create outputs and profile retries also affect
counts. The demo therefore explains purposes instead of promising a fixed count.
API assertions are not measured user-visible provider prompts.

Creation normally begins with two different accesses: `create` registers the
credential, then `verify-created` checks that its assertions match the ACC's strict
signing profile **before deployment**. PRF fallback or profile retries can add
requests. After activation, P-256 creation signs the sealed viewing-key inbox
publications separately (reader envelopes and registrations). Each signature now
has its own numbered setup review. These are not repeated login or wallet-transfer
requests; the compatibility probe and signature checks remain enabled.

Declining a later setup signature does not remove the deployed ACC or an earlier
publication. Preserve the original account/operation evidence and use the original
passkey's reopen/reconciliation path; do not create a replacement account merely
because the final setup request was declined.

The WebAuthn adapter shares PRF outputs among nested/overlapping users of one
adapter until its last session exits, then clears its held buffers. This is
**not** independent account/capability isolation for unrelated concurrent callers.
Hosts should not share that adapter across unrelated approved operations. Broader
session isolation and prompt-budget qualification remain
[#245](https://github.com/input-output-hk/midnight-passport-sdk/issues/245).
The optional `CredentialPort.withLoginSession` additionally fences overlapping
logins and creation during login. The browser implementation clears login buffers
at callback completion even if a misbehaving host leaves a child unawaited, and
refuses late identification results. Hosts must await all work inside the callback.
Adapters without this optional port retain their existing login behavior.

## Source preview: opt-in JubJub sessions

The local source after RC7 adds an explicitly approved, PRF-derived session child
with a recipient/asset-pinned, capped grant and a mandatory 10–30 minute chain
expiry (15 minutes by default). Eligible unshielded withdrawals retain exact
transfer consent and use JubJub without another passkey. Owner administration,
wallet derivation and outside-scope transfers retain fresh passkey paths.

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
