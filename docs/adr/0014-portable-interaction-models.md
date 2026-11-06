# ADR 0014: portable public interaction models and host-owned controls

Status: accepted for local source after RC7 (2026-11-06).

## Problem

Partners need to compose Passport account operations in their own interfaces. The
demo currently combines its DOM, action log and progress arithmetic. Copying that
page into React or React Native would also copy layout, brand decisions and
browser assumptions. Adding a framework to the account package would constrain
every consumer, including service and command-line hosts.

## Decision

Expose the small, optional `mn-passport-account/interaction` subpath. It projects
public host observations into immutable operation and journey snapshots and
provides a presentation store with stable reads and detachable subscriptions.
The subpath has no imports, timers, DOM, Node, credential or transaction access.
It adds no package or framework dependency. The existing demo consumes its
stage arithmetic through its own text/flow adapter.

The SDK does not decide that a wallet connection grants ACC ownership, that a
timeout failed a transaction, or that an estimate establishes finality. The host
supplies observed phases, original public IDs, redaction and lifecycle facts.
The store's revision comparison only rejects stale presentation writes. The
existing durable journals, account guards, Web Locks, key sessions and chain
reconciliation remain authoritative.

Renderers are separate. `OperationStatus`, `Journey` and `ActivityPanel` may use
these snapshots in any layout with host-owned branding and theme. Consent stays
a blocking interaction before every credential request. Hiding an activity
panel, unsubscribing a React effect or disposing a presentation store cannot
cancel, revoke or replay a transaction.

## Boundaries and consequences

- No tenth package or new release axis. The subpath is additive local source;
  published RC7 does not include it.
- The demo remains the browser composition example, not the SDK architecture.
  Its action names, human-readable estimates and copy remain app-owned.
- Framework adapters should be thin consumers of the public store. First prove
  one optional React example before creating a separately published UI package.
- React Native requires separately qualified credential, storage, transport and
  rendering adapters; platform-neutral types alone do not establish support.
- `lace-sdk` integration is outside this milestone. The separate Lace Wallet
  connector must not silently acquire viewing, spending or owner permissions.
- Explicit copies discard unknown fields; callers must still supply only public
  values in approved text and reference fields. This is not a general secret
  detector, event journal, storage format or audit-log redactor.

## Delivery

[Milestone](https://github.com/input-output-hk/midnight-passport-sdk/milestone/3),
[#289](https://github.com/input-output-hk/midnight-passport-sdk/issues/289),
[execution map](../prototype/ux-milestone.md),
[consumer guide](../site/interaction.md).
