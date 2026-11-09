# ADR 0017: Explicit operation consent and a pinned signer route

Status: accepted for local implementation, 2026-11-07. Refs Q9, ADR 0015 and
[the authenticated-owner guide](../site/authenticated-owner.md).

## Decision

Authentication unlocks a capability; it is not blanket operation consent.
Expose `createAccountAuthorisation` from `account/authorisation`. The host supplies
the primary account, an optional authenticated-owner account/checked lease and
a `consent.review` port and required synchronous `isContextCurrent(): boolean` host guard. The package supplies no dialog or framework dependency.

Each `run({ route, flow }, work)`:

1. Pins the account/network/binding and explicit `primary` or
   `authenticated-owner` route before the review. A primary route uses the host's
   configured signer: it may be a passkey-backed browser flow or a Node signer;
   the host supplies an accurate credential label. A curve alone does not prove
   how the key is stored or whether a passkey ceremony will occur.
2. Validates and copies the public flow descriptor. Provider extensions are not
   exposed in consent. Explicit grant/opening metadata can be privacy-sensitive;
   hosts must redact Audit payloads rather than logging the entire review object.
   The host presents the recipient, asset, amount, device,
   grant or rotation scope required by that operation.
3. Requires an explicit positive response; decline starts no operation.
4. Rechecks the host account-selection/authentication revision with `isContextCurrent()`
   on both routes, as well as the same owner lease and pinned account after review. Lock, expiry,
   replacement or an account switch refuses; it never falls back to a passkey.
5. Runs the callback with that already-opened account. Private reads recheck the
   lease afterwards. Mutation acknowledgements are retained after local expiry;
   guarded transports still refuse each new dispatch after expiry.

This layer does not verify an on-chain owner, enroll a companion, invent a grant,
or replace binding-specific signature checks. The host must open/verify the
authenticated account using the existing SDK flow before supplying it. A
scoped grantee is not an authenticated full owner and must use the grant-holder
API. Its lease must not be passed as an owner candidate.

The demo's existing externally-reviewed compatibility facade is moved into the
SDK under `routeAuthenticatedAccount`. It checks a lease at method use and pins
extracted methods to their account instance. Public reconciliation reads remain
available after local lock. New hosts should use the explicit `run` boundary,
not a proxy that silently substitutes schemes in a single binding.

## Policy retained

The updated owner policy (2026-11-08) requires passkey login and fresh approval
for critical operations, including when a deterministic PRF-derived JubJub full
owner is unlocked. The demo's authenticated-operation hook checks the fresh
credential-derived owner and reader against the captured lease. A full owner
retains its durable on-chain authority; the host policy and local timeout do not
narrow or revoke that entry. Enrolling a P-256 companion requires explicit review
and live verification. Routine seed/reader leases and expiring scoped grants stay
separate. Only transfers outside a separately approved scope need fresh owner
passkey approval; in-scope transfers retain their exact transfer consent. The SDK
never silently changes routes or grants a host blanket consent.

The host WebAuthn adapter reviews each actual passkey credential ceremony. The
reference demo combines its generic operation context and actual ceremony in one
blocking dialog; staging context alone grants no credential approval. Exact
transaction/device/grant reviews remain necessary where their final data arrives
later. The route review does not suppress a platform authenticator dialog or
allow a worker/background service to invoke credentials. The operation callback
must use the reviewed fields, and direct access to a supplied account remains a
trusted-host capability, not a sandboxed permission system.

Connector operations snapshot transfer, grant and device inputs before awaiting
ports. This keeps their later reviews, signatures and journal records aligned
even if a caller mutates its original DTO. Byte snapshots include Node Buffer
inputs; readonly annotations alone are not a runtime boundary.

## Independent review correction

The first candidate could not observe a host selection change on the primary
route: the captured account object correctly remained A when the UI selected B.
Both routes now require a host context guard before review/callback and after
private reads. Unit cases cover context switches during review, private reads
and post-dispatch acknowledgement retention. Do not supply an asynchronous guard
or a no-op in a switchable host; bind it to the scope's captured revision.

The router does not cancel a running operation or inject checks into an existing
connector's private ports. Hosts must also bind their signer/transport guards
and flow cancellation to this context lifetime for later in-flight dispatches.
The callback boundary checks and private-result fence do not replace those guards.


## Source follow-up: exact review and session ownership — 2026-11-08

The reusable coordinator now captures the selected scheme and checker function with
its receiver before review. It refuses replacement before dispatch/private-result
release and retains mutation acknowledgements after dispatch. Public byte admission
uses intrinsic lengths and actual elements, independent of custom iteration or
shadowed lengths. These checks do not turn the trusted operation callback into a
sandbox or inject lifecycle policy into arbitrary downstream ports.

The browser P-256 `withdraw-unshielded` key session can own the stable selection
without eagerly loading PRF outputs. The core still invokes `withKeySession` with
its exact descriptor and obtains a fresh strict P-256 transaction signature. Direct
PRF sessions, other key flows and login retain their existing key requirements.
Selection/ownership epochs fence overlapping selectors and late work; known profile
retries remain separately approved assertions. See the
[source design record](../research/2026-11-08-p256-sign-only.md).

The demo stages immutable owner-transfer/export intent into its actual `derive-keys`
or `sign` review and verifies the approved fields at the value POST or sensitive
handoff display boundary. Staging alone grants nothing. Prompt-free bounded grant
transfers retain standalone exact consent; other administration reviews may remain
separate. This is demo host composition, not an automatic library dialog or full-owner
restriction. Source contract tests and synthetic browser qualification remain separate;
no real-provider/native acceptance or published-RC7 behavior change is asserted.


## Residual risk: cached full owner in the reference host

The explicit full-owner mode keeps a full-authority scalar in page memory. Code
with that memory access can bypass host consent and retain a usable copy after
the local lease expires. Fresh approval and JavaScript zeroing do not constrain
such a copied key on chain. This is a custody limitation of the software-owner
mode, not evidence that login or the routine reader lease contains an owner key.

The preview retains this opt-in mode to demonstrate the supported software-owner
composition. A different custody boundary needs a separately qualified signer or
host integration; timers cannot supply it. Mitigations are explicit unlock risk
copy, a ten-minute default (15/30 only by selection), memory-only owned copies,
lock/hidden-tab/expiry disposal, fresh pinned critical approval and independently
bounded grants for suitable transfers. No persistence or weaker consent is added.
The normal routine-reader route remains owner-free. Contract-level removal and
recovery retain their documented limitations; local lock is never described as
complete revocation or guaranteed memory erasure.

Fresh owner approval now uses the immutable RP ID/origin scope admitted with the
lease. The operation controller captures that scope and rechecks its identity
across asynchronous approval; renewal or replacement cannot substitute a new RP
scope for an existing action. The reference connector is still localhost-pinned:
this seam is not a claim of non-localhost provider/deployment qualification.
