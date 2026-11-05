---
layout: default
title: Consent and passkey purposes
permalink: /consent/
---

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

The page shows the current purpose before each ensuing browser access, including
retry attempts. Provider-controlled passkey dialogs remain unchanged. The operation
log links approval and ceremony notices with a public flow ID; it excludes key
material and grant openings. A demo approval ends when that action finishes or
fails, rather than staying active after login.

Some preparations need viewing access before exact transaction details are known:
rotation inspects encrypted holdings, and grant use identifies/unlocks its holder.
The first review explains that access. The later transaction/device/grant dialog
still reviews the exact live scope, recipient, amount or reader fingerprint before
signing. An approved unlock is not permission to substitute another operation.

Cancellation stops future work. It cannot undo already confirmed publications or
prove an uncertain submission never happened. Preserve original request IDs and
transaction receipts, inspect the log and reconcile before another effect.

## Prompt budgets and session lifetime

P-256 signs each account transaction through its authenticator, so a multi-transaction
operation may need several prompts. JubJub signs in software after the approved PRF
unlock. Provider behavior, held create outputs and profile retries also affect
counts. The demo therefore explains purposes instead of promising a fixed count.
API assertions are not measured user-visible provider prompts.

The WebAuthn adapter shares PRF outputs among nested/overlapping users of one
adapter until its last session exits, then clears its held buffers. This is
**not** independent account/capability isolation for unrelated concurrent callers.
Hosts should not share that adapter across unrelated approved operations. Broader
session isolation and prompt-budget qualification remain
[#245](https://github.com/input-output-hk/midnight-passport-sdk/issues/245).

## A local JubJub session signer is a separate feature

A P-256 owner can approve a limited grant to a local JubJub signer. Such delegation
must define permitted operations, asset/recipient/caller constraints, caps and a
short on-chain expiry, plus renewal, locking and revocation. It is not currently
implemented as a session workflow in this demo.

Enrolling a local signer as another owner gives independent owner authority.
A browser login flag does not constrain that authority on chain. Local key disposal
is not grant revocation, and browser compromise can use a live local signer.
Neither that key nor the ACC viewing secret is an HD-wallet recovery seed.
The proposed opt-in workflow is
[#281](https://github.com/input-output-hk/midnight-passport-sdk/issues/281), milestone
`0.2.0`; RC7 does not silently enable it.

See the [use-case evidence map]({{ '/use-case-coverage/' | relative_url }}) for what
the automated browser tests establish. Google/iCloud synchronization and restoration
remain independently qualified provider behavior.
