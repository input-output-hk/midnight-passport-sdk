---
layout: default
title: Operation authorization
permalink: /authorization/
---

**Source preview after RC7.** These optional `account/authorization` and
`account/validation` exports are not in published `0.1.0-rc7`. This is the reusable
library contract. The [demo guide]({{ '/demo-guide/' | relative_url }}) describes its
additional login, fresh-passkey and memory-lease policies.

## Review and execute the same operation

`createAccountAuthorisation` captures an already verified account's address, network
and binding. Each `run` selects `primary` or `authenticated-owner` before review.
`AccountConsentPort.review` must return exactly `true` to proceed. The host renders
the exact request and implements the decision; the library creates no dialog or
credential request. `create-account` is refused here: review creation and its
`retireAuthority` choice before calling the creation API.

This example accepts an opened account and host-owned lifecycle/review functions.
It parses unknown form input, then executes the snapshot returned with approval:

```ts
import type { PassportAccount } from '@input-output-hk/mn-passport-protocol';
import {
  createAccountAuthorisation,
  type AccountConsent,
} from '@input-output-hk/mn-passport-account/authorization';
import { UnshieldedWithdrawalSchema } from '@input-output-hk/mn-passport-account/validation';

export async function reviewedWithdrawal(
  primary: PassportAccount,
  isContextCurrent: () => boolean,
  review: (request: AccountConsent) => Promise<boolean>,
  input: unknown,
) {
  const transfer = UnshieldedWithdrawalSchema.parse(input);
  const policy = createAccountAuthorisation({
    primary,
    isContextCurrent,
    consent: { review },
  });
  return policy.run(
    { route: 'primary', flow: { kind: 'withdraw-unshielded', ...transfer } },
    async (account, approved) => {
      if (!account.withdrawUnshielded) throw new Error('Withdrawal is unavailable');
      return account.withdrawUnshielded(UnshieldedWithdrawalSchema.parse(approved.flow));
    },
  );
}
```

Capture a host account/authentication revision when constructing this policy.
`isContextCurrent()` is synchronous and returns true only while that revision is
current. A route's curve does not identify its custody: a primary account may use
browser passkeys or a Node signer. Label the actual host capability accurately.
The callback is trusted application code; the coordinator cannot prevent it from
calling a different method or using different arguments. Execute the approved
snapshot and retain connector/transport checks at each new dispatch.

## Authenticated full-owner route

Supply `authenticated: () => lease` to offer the second route. A lease has an
`account: PassportAccount` with `scheme: 'jubjub-schnorr'` and `check(): void`.
Return the same lease object while that authentication is current; create a new
object when it is replaced. Do not manufacture a wrapper on every lookup.
The account must match the captured address/network/binding. The host first verifies
live ownership and sealed-reader correspondence; `check` throws after expiry, lock
or replacement. The coordinator does not perform those chain checks itself.

It captures the selected scheme and checker function/receiver before review, then
checks context, scheme, lease-object and selected account/check identity before the callback.
Replacing the checker in place cannot substitute a new lifetime decision, and an
in-place scheme change cannot relabel an existing approval. A different instance
sharing a prototype checker is still a different lease. Replacement or expiry refuses without choosing the
primary route. It rechecks after `read-holdings` and `sign-in` callbacks so stale
private reads are not returned. Mutation receipts survive a later context change;
retain them for reconciliation rather than presenting a dispatched result as absent.

A full owner retains full on-chain authority. Host expiry and fresh-passkey rules do
not narrow that authority. A separately issued bounded grant is a different signing
capability. The SDK installs neither policy automatically. See
[demo authority choices]({{ '/demo-guide/#understand-the-three-local-authority-choices' | relative_url }}).

## Admission and owned values

Validation brands distinguish accounts, assets, recipients, amounts, networks and
bindings even when wire encodings match. Amounts are canonical decimal base units,
without rounding/coercion; the withdrawal schema requires a positive U128 value.
Shape validation does not establish ownership, live balances or valid grant authority.

`run` validates known flow fields, strips extensions and copies device-policy byte
arrays before awaiting review. Byte lengths use the typed array's intrinsic length;
copying uses its actual elements, ignoring shadowed lengths and custom iterators.
Reader-policy fields must have their exact 32/21-byte lengths; malformed/proxy/detached
views refuse as `InvalidContext`. Buffer inputs become independent Uint8Array copies.
The review and callback receive separate flow copies.
Top-level readonly/frozen records are not a universal deep-freeze guarantee; typed
arrays remain mutable. Keep your own inputs stable and do not treat a schema as a
sandbox for hostile objects with getters or custom prototypes.

`routeAuthenticatedAccount` is a compatibility facade for hosts that already choose
and review a route. Prefer `createAccountAuthorisation` for new wiring. Only its
optional authenticated-operation hook performs the stricter argument admission:
plain data objects, dense arrays, finite numeric values and owned byte copies;
no accessors, symbols, cycles or custom object prototypes. Limits are depth 8,
4,096 value nodes, arrays of 1,024 items, 64 keys per object, and an aggregate 65,536
string-code-unit/byte-length budget. Empty public byte arrays are allowed within
that budget; secret-store values have their own nonempty rule. Supported flow options retain only the trusted
`signal` and `onEvent` capabilities. Without that hook, the facade does not snapshot
primary-route arguments or add fresh approval. Public state/roster reads stay on the
primary account. Neither helper grants authority or supplies a credential UI.

## Errors, cancellation and retry

| Outcome | Handling |
| --- | --- |
| `AccountAuthorisationError: InvalidContext` | Invalid route, flow or mismatched account; correct the input/context before another review. |
| `Unavailable` | Missing, stale or replaced scope/lease; explicitly reopen or reauthorize, without signer fallback. |
| `Declined` | Review did not return true; stop the operation. |
| Validation failure | Public Zod parsers, including the initial account-context parser, can throw a Zod error; report field errors without exposing secrets. |
| Host/operation failure | Review, lease checks and callback errors propagate; normalize them at your host boundary. |

The coordinator has no timer, `AbortSignal` option or retry loop. Cancel a review by
returning false; pass supported flow options to the operation itself when needed.
Cancellation cannot undo submission. Retry requires a new explicit review and must
respect original IDs and unknown-outcome fences. Never retry a mutation solely because
a host callback timed out. See [recovery]({{ '/durability/' | relative_url }}).

The [authorization tests](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/tests/account-authorization.test.mjs)
and [snapshot tests](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/tests/request-snapshots.test.mjs)
exercise selection, mutation isolation and stale scopes with controlled ports. The
[source boundary regressions](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/tests/overnight-authorization-boundaries.test.mjs)
cover checker receiver/replacement, scheme changes, intrinsic byte admission and
post-dispatch receipt retention. They do
not qualify a real passkey provider or native transaction execution.
