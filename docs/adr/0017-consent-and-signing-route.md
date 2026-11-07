# ADR 0017: Explicit operation consent and a pinned signer route

Status: accepted for local implementation, 2026-11-07. Refs Q9, ADR 0015 and
[the authenticated-owner guide](../site/authenticated-owner.md).

## Decision

Authentication unlocks a capability; it is not blanket operation consent.
Expose `createAccountAuthorisation` from `account/authorization`. The host supplies
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

The owner's approved full-owner mode permits deterministic PRF-derived JubJub for
all implemented owner operations during the authenticated lease. Enrolling it
on a P-256 ACC requires explicit consent and live verification. Local timeout
does not expire its durable owner entry. Routine reader/wallet unlock and capped
expiring grants remain distinct choices. The SDK does not silently downgrade or
upgrade one mode to another.

Passkey credential ceremonies remain separately consented by the host WebAuthn
adapter. The route review does not suppress a platform authenticator dialog or
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
