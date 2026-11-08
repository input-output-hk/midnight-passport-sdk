---
layout: default
title: Library integration guide
permalink: /library-guide/
---

Use the Passport libraries to build your own browser, wallet or Node host. Your host owns
consent, persistence, key lifetime and transaction recovery. The reference demo is one
composition of those libraries; its navigation, memory leases, funding wallet and local
storage choices are not SDK defaults. To run that application, use the
[Demo app guide]({{ '/demo-guide/' | relative_url }}).

## Choose released packages or source preview

[Install and connect]({{ '/getting-started/' | relative_url }}) is the **published
`0.1.0-rc7`** path. Install matching exact versions and use the release-tagged browser
quickstart. The [package map]({{ '/packages/' | relative_url }}) identifies the nine
implemented libraries and their dependency direction.

The checked-out source also has **unpublished additions after RC7**: validation,
authorization, secret-store and background subpaths; interaction/naming/wallet helpers;
verified-login handoff; and authenticated-owner/scoped-session helpers. A source export
or a source test does not make that feature available from RC7. Consult the
[API release map]({{ '/api/#published-and-source-preview-surfaces' | relative_url }})
before selecting an import. Keep source builds and published consumer evidence separate.

## Select the boundary you own

| Host | SDK entry | Host responsibilities |
| --- | --- | --- |
| Browser account UI | `createBrowserPassport` from `adapter-browser` | Exact network/binding/manifest pins, passkey RP/origin, consent UI, account records, backend ports and bundler setup. |
| Wallet or custom runtime | `createPassportAccounts` from `account`; types from `account/ports` and `protocol` | Credential/authorizer/key sources, checked chain reads, proof/submission ports, reviewed operation policy and persistence. |
| Proving or HTTP backend | `service`, `adapter-service`, `contract` | Verified artifact/key cache, authenticated ingress, sponsored-fee limits, durable jobs and value routing. |
| ACC or application-contract integration | Versioned `contract` binding and compiler dependency export | Compatible compiler/runtime and circuit inputs; see [partner contracts]({{ '/partner-integration/' | relative_url }}). |

The portable account/key layers do not create your DOM, React tree, wallet vault or
worker. An ACC viewing secret, a passkey signer, a wallet seed, fee sponsorship and
funding are different capabilities. Passing one does not grant the others.

## Integrate in lifecycle order

1. **Pin and inspect.** Resolve the packaged binding, verify the independently trusted
   manifest/network and check service configuration. RC7's `account/preflight` and
   `contract/capabilities` describe supported composition/proof requirements before
   credential access; advertised support does not prove keys, provider or service readiness.
2. **Provide records before creation.** Implement `AccountRecordStore` and, when needed,
   encrypted grant/recovery journals with network, binding and account/device scope.
   Preserve pending IDs, sealed entries, counters and uncertain dispatch records. A
   directory response is a hint; verify live ownership and sealed keys before adoption.
3. **Admit and review one operation.** Validate input before expensive key/chain work,
   capture its owned values before an asynchronous review, and pin account, route and
   authority. Request only the credential purpose needed now. Creation must explicitly
   decide `retireAuthority`; retiring maintenance authority prevents later upgrades.
4. **Execute with checked ports.** Use complete live device/holding/read-grant sources for
   rotation/removal; supply a value-capable call path for transfers. Recheck the selected
   account/authentication revision before new private work and dispatch. Lock or expiry
   must refuse rather than silently select another signer.
5. **Retain the outcome and release resources.** Capture a transaction receipt even if
   local authority expires after dispatch. Reconcile an unknown outcome under its original
   ID. Clear caller-owned secret copies in `finally`, dispose local keys, unsubscribe
   observers and close only workers/channels/stores your host created.

A host cancellation stops future work; it cannot undo a confirmed or already dispatched
transaction. A local key lock neither revokes an on-chain grant nor removes an enrolled
owner. Source owner/session helpers require host teardown and live authority checks;
they are not durable, automatically restored sessions.

## Source preview: input admission and operation policy

`account/validation` exports distinct branded account/asset/recipient values and bounded
canonical decimal amounts. Parsing checks shape, not ownership, chain freshness or
spending authority. Amounts are base units, with no rounding or numeric coercion.
Byte fields and nested grant/device inputs must be owned copies before the first await;
`readonly` types alone do not prevent aliases or Buffer-backed mutation.

`account/authorization` supplies `createAccountAuthorisation` for one captured account,
route and reviewed operation. It creates no credential UI, timer or automatic fresh
passkey check. The host callback executes the approved snapshot and the connector
retains dispatch checks. See the [authorization guide]({{ '/authorization/' | relative_url }})
for a complete typed withdrawal example, route admission, errors and cancellation.

## Source preview: checked service configuration

Load service configuration against independently trusted pins before selecting runtime
ports. The checked discovery APIs bound response bytes and time; they do not establish
that every advertised service is trusted or operational. See
[configuration contracts]({{ '/api/#source-preview-checked-configuration-contract' | relative_url }})
for limits, transport expectations, validation and a typed source example.

## Source preview: P-256 signing without unused PRF access

The browser adapter's P-256 unshielded withdrawal now enters a scoped ownership
boundary without eagerly loading PRF outputs. That operation uses the selected public
binding and live device counter, then obtains a **fresh strict P-256 transaction
signature**. Its normal software-authenticator path has one `sign` credential request
and no PRF request. Known format retries still require fresh requests and reviews.
This does not reuse a login assertion as transaction approval.

The core's `withKeySession` hook and exact flow descriptor remain available to host
guards. Public `prf.withSession` and other key-session flows retain eager PRF access;
a host that explicitly derives a secret inside this withdrawal still needs that
reviewed access. Login, sealed reads, shielded/private holdings and journal work keep
their own required key paths. Selection/binding ownership, refusal of overlapping
selectors and disposal remain enforced; no timer, persistent session or new permission
is installed. These are source changes after RC7, with actual-crypto/software-provider
and fake-chain evidence, not native/provider qualification. See the
[design and regression record](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/research/2026-11-08-p256-sign-only.md).

The SDK still supplies no transaction dialog or automatic fresh-passkey policy for a
software full owner. The [demo consent guide]({{ '/consent/' | relative_url }}) describes
how that host binds an exact transfer/export review to its actual credential call.

## Custody and cleanup

`AccountRecordStore` contains account metadata and sealed state; it is not a seed store.
The optional source `SecretStore` has explicit `(namespace, networkId, bindingId,
account, id)` scope and compare-and-swap versions. Reads and successful writes return
caller-owned byte copies. Clear those copies after use. Missing data, a provider outage
and a version conflict have different outcomes.

`createMemorySecretStore()` is ephemeral. `createBrowserSecretStore({ allowPlaintext:
true, ... })` is explicitly plaintext IndexedDB with `protection: 'none'`; it is not an
OS keychain or production wallet vault. `close()` closes the local handle; it does not
delete persistent records or revoke authority. No SDK default writes an owner scalar or
raw PRF output to this adapter. See [secret custody]({{ '/secret-storage/' | relative_url }}).

The optional background client is for bounded read/computation work, with explicit
owned-channel shutdown. A worker timeout is not a transaction outcome and must not
cause a transaction retry. A browser host keeps credentials and consent in its trusted
UI context. See [background contracts]({{ '/background/' | relative_url }}) for method admission,
timeouts, browser/Node ports and the distinction between client close and server stop.

Persisting a private session needs a separately chosen custody/access/expiry/removal
policy. The [upstream restoration research](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/research/2026-11-08-session-restoration.md)
observes wallet ciphertext stored alongside a usable decrypt key; restoring that wallet
does not establish fresh passkey verification or restored ACC owner authority. The
reference SDK demo does not adopt automatic private-session persistence from that research.

## Errors, recovery and evidence

Branch on typed error codes, not messages. Account flows use `PassportConnectorError`;
source authorization, storage and background seams expose their own bounded error types.
Distinguish a decline, invalid input, unsupported provider, unavailable dependency and an
unknown transaction. Sanitize provider errors and never include PRF outputs, seed/scalar,
viewing secrets, grant openings, tokens or witnesses in public traces.

Use [durability]({{ '/durability/' | relative_url }}),
[grant recovery]({{ '/grant-recovery/' | relative_url }}) and
[shielded-deposit continuation]({{ '/shielded-deposit-recovery/' | relative_url }}) when
implementing restart behavior. Restore original evidence; do not clear journals or start a
replacement intent to bypass an unknown result.

Source contracts are exercised by the
[authorization tests](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/tests/account-authorization.test.mjs),
[request snapshot tests](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/tests/request-snapshots.test.mjs),
[validation tests](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/tests/domain-validation.test.mjs),
[storage tests](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/tests/secret-store.test.mjs)
and [background tests](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/tests/background.test.mjs).
They establish those tested boundaries. They do not qualify a real passkey provider,
full Lace Wallet compatibility or combined browser/native transaction proofs. Use the
[qualification map]({{ '/qualification/' | relative_url }}) for the relevant evidence tier.
