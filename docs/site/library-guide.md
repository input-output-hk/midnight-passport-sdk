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
implemented libraries and their dependency direction. Its
[runtime/export index]({{ '/packages/#runtime-and-host-requirements' | relative_url }})
separates neutral APIs, browser capabilities, fetch transports and Node backend code;
import/type support is not provider or transaction readiness.

The checked-out source also has **unpublished additions after RC7**: validation,
authorization, secret-store and background subpaths; interaction/naming/wallet helpers;
verified-login handoff; and authenticated-owner/scoped-session helpers. A source export
or a source test does not make that feature available from RC7. Consult the
[API release map]({{ '/api/#published-and-source-preview-surfaces' | relative_url }})
before selecting an import. Keep source builds and published consumer evidence separate.

### Evaluate the current source

Use a checkout at the reviewed revision with its matching `flake.lock`,
`pnpm-lock.yaml` and prepared dependencies. From that repository, build the declared
packages and check the public documentation examples in the pinned tooling shell:

```sh
nix develop -c pnpm run build
nix develop -c pnpm run test:docs
```

These steps need no running demo, chain, wallet or credential provider. They check
source/build contracts; account operations still need the host ports below. Import
through the public package entries, not `packages/*/src` paths. Browser examples
need their declared DOM/worker and bundler capabilities; Node import acceptance
does not supply native Node passkeys or browser IndexedDB.

The [copied-source consumer check]({{ '/quality/#copied-source-consumer-check' | relative_url }})
also checks built public exports in a fresh external directory. It copies declared
SDK artifacts and reuses physical external dependencies; it does not perform a
package-manager installation. Neither check changes RC7 package contents or makes
source-only imports available from an RC7 install. Keep the source revision and
the exact check receipt with your evaluation.

## Select the boundary you own

| Host | SDK entry | Host responsibilities |
| --- | --- | --- |
| Browser account UI | `createBrowserPassport` from `adapter-browser` | Exact network/binding/manifest pins, passkey RP/origin, consent UI, account records, backend ports and bundler setup. |
| Wallet or custom runtime | `createPassportAccounts` from `account`; types from `account/ports` and `protocol` | Credential/authorizer/key sources, checked chain reads, proof/submission ports, reviewed operation policy and persistence. |
| HTTP client in a browser or fetch-capable Node host | `adapter-service` | Trusted service URL/pins, authorization headers where required and interpretation of receipts/unknown outcomes. It does not start a backend. |
| Embedded Node backend | `service`, `contract`; host-specific proof/wallet adapters | HTTP server wiring, verified artifact/key cache, authenticated ingress, sponsored-fee limits, durable jobs and value routing. |
| ACC or application-contract integration | Versioned `contract` binding and compiler dependency export | Compatible compiler/runtime and circuit inputs; see [partner contracts]({{ '/partner-integration/' | relative_url }}). |

The portable account/key layers do not create your DOM, React tree, wallet vault or
worker. An ACC viewing secret, a passkey signer, a wallet seed, fee sponsorship and
funding are different capabilities. Passing one does not grant the others.
For an optional source-only seed handoff during verified open, see the
[login lifecycle example]({{ '/account-keys/#source-preview-use-wallet-material-during-verified-login' | relative_url }}).

## Build one integration module first

Keep the first module independent of your application UI:

* A browser host starts with the [released browser composition]({{ '/getting-started/#4-compose-the-browser-account-api' | relative_url }}). Supply its account-record store and trusted backend configuration; return the API to your UI. Construction is not an account-opening action.
* A custom wallet or Node host starts with `createPassportAccounts(ports)`. Implement the contracts from `account/ports` using its existing credential/key source and chain/proof/submission system. The neutral account package does not supply a Node passkey provider or start an HTTP server.
* An HTTP operator integrates the [service contracts]({{ '/service/' | relative_url }}) separately. A browser need not embed a service, and a service need not import the browser adapter.

Expose create/open and public state before adding another operation. The minimal
browser recipe omits the complete holding/grant sources and value-capable call path
needed by administration or transfers. Add those ports when you add the corresponding
UI action; use the [method prerequisites]({{ '/api/#optional-methods-and-host-prerequisites' | relative_url }})
as the checklist. Account opening does not connect an HD wallet or fund the ACC.

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

`account/authorisation` supplies `createAccountAuthorisation` for one captured account,
route and reviewed operation. It creates no credential UI, timer or automatic fresh
passkey check. The host callback executes the approved snapshot and the connector
retains dispatch checks. See the [authorization guide]({{ '/authorization/' | relative_url }})
for a complete typed withdrawal example, route admission, errors and cancellation.

Source durability calls also capture original invocation ID, signal/callback and
explicit cancelled-resume choice before awaits. A host cannot change a pending
call by editing its options. Journal documents must match the requested ID. The
[durability contract]({{ '/durability/#source-preview-pin-one-invocation' | relative_url }})
describes refusals and the boundary between original-intent recovery and replay.

The Midnight holding adapter owns the coin bytes it verifies and returns fresh
qualified values; an injected nullifier callback receives a separate copy. Supply
the complete [holding-indexer contract]({{ '/api/#ports' | relative_url }}), not only
an inbox decoder. Source snapshots protect tested asynchronous boundaries, not
arbitrary hostile host code or external chain freshness. The per-call
`createHeldCoinWitness` also owns nonce/color inputs and each returned copy, including
Node Buffers; its exact color/value/index checks still apply.
The optional [routine-reader seam]({{ '/api/#source-preview-optional-routine-reader' | relative_url }})
accepts host-approved holdings access; its lifetime and refusal policy remain host-owned.

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

## Private account keys and public proof artifacts

Use [Account keys and recovery]({{ '/account-keys/' | relative_url }}) for owner, reader,
viewing-secret and wallet-seed contracts. Use [Public proving artifacts]({{ '/keys/' | relative_url }})
for ZKIR, verifier/prover hashes, cache restoration and HTTP serving. These are
different APIs and deployment responsibilities. Neither determines your host's
login or transaction-approval policy.

## Custody and cleanup

### Persistence owners

Each port stores different data. The host supplies storage and its scope; wiring
one store does not automatically persist the others.

| Port / data | Stored material | Host lifetime and recovery responsibility |
| --- | --- | --- |
| `AccountRecordStore` | Address, binding, scheme, optional credential ID and local use counter | Device/account metadata only. Preserve bigint/byte encodings and scope the host store by network, binding and device/account. The port has `read`, `write` and `exists`, with no generic remove/close method. |
| `AccountDirectory` / `AccountHint` | Untrusted credential-to-account pointer, public device/policy fields and status; applicable pending hints can also retain boot salt and sealed `keyEntries` | Persist pending activation material before relying on recovery. Verify hints against the live ACC and selected key origin. Its `get`/`put` interface supplies no generic deletion or vault-close operation. |
| Grant, mutation and deposit journals | Their original intents, protected outputs/openings, revisions and transaction/recovery references | Supply each required encrypted/durable provider; retain unknown and pending IDs. A metadata store is not their backing store. See [recovery contracts]({{ '/durability/' | relative_url }}). |
| Optional source `SecretStore` | Explicitly chosen scoped secret bytes and version tokens | Host opts into custody, access and persistence. Versioned `remove` and local `close` have provider-specific persistence effects; neither revokes chain authority. See [secret custody]({{ '/secret-storage/' | relative_url }}). |

Account records contain no sealed entries, viewing secret or wallet seed. Pending
hints and journal plaintext can contain sensitive recovery/linkage data; do not
turn them into public logs or delete them to bypass an unknown operation.

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

## Funding a Passport account

Fee sponsorship and value funding use separate ports. The HTTP funding client
accepts a caller-owned stable UUID; it does not create a deposit ID or verify chain
credit on its own. Current source captures and validates the original request
before loading fresh credentials and binds the response to that same ID. Read
the [funding client contract]({{ '/service/#source-preview-funding-intent-and-observation' | relative_url }})
for Uint128 admission, explicit observation deadlines and uncertain-result handling.
The demo's fixed offered assets, loopback proxy and funding wallet are its chosen
composition, described in the [demo guide]({{ '/demo-guide/' | relative_url }}).

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
