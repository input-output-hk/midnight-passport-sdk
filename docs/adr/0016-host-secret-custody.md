# ADR 0016: Host secret custody through an async port

Status: accepted for local implementation, 2026-11-07. Refs Q10 and ADR 0015.

## Context

Passkey PRF material, deterministic JubJub owner keys, HD wallet seeds and random
ACC viewing secrets have different lifecycles. A passkey-derived owner does not
make the ACC viewing secret reconstructible without its sealed envelopes. The
existing encrypted journal byte store is not a general secret-custody interface.
Partners may own storage, including a future Lace Wallet provider.

## Decision

Define the structural, asynchronous `SecretStore` in `account/ports`. Its key is
the tuple `(namespace, networkId, bindingId, account, id)`. A store never enumerates
all secrets, chooses a credential, opens an account, signs, or grants authority.

Operations:

- `read(reference)` returns an owned byte copy plus an opaque version, or
  `undefined` for absence. Unavailability must throw, not masquerade as absence.
- `write(reference, bytes, expectedVersion)` atomically creates (`null`) or
  replaces the exact reviewed version. It copies inputs before its first await.
- `remove(reference, expectedVersion)` atomically removes that version only.
  A stale version or missing record is a conflict.
- `close()` ends the local handle. It does not delete persistent records or
  revoke chain ownership/grants. Hosts still check authentication leases around
  private reads and key use; closing a store is not a transaction cancellation.

Secret values are bounded to 64 KiB. References are validated and unambiguously
encoded. Versions cannot be reused after deletion/recreation in a live store.
Implementations must not log values or expose provider error messages/causes.
The caller clears returned copies; implementations clear their owned temporary
buffers where possible. JavaScript cannot guarantee erasure of all engine copies.

Ship two reference adapters without adding a package:

1. `account/secret-store`: memory only, suitable for ephemeral hosts and tests.
2. `adapter-browser/secret-store`: async IndexedDB with transactional compare-and-
   swap. It requires explicit `allowPlaintext: true` and reports `protection:
   'none'`. It is an opt-in reference, **not an encrypted or hardened vault**.

The demo's authenticated owner remains memory only. No existing keys are migrated
or automatically written to IndexedDB. Browser persistence is an independently
testable facility for hosts that explicitly choose it; PRF recipes do not change.
Prover/verifier keys are public artifacts and do not belong in this store.

## Lace provider seam

A future Lace Wallet integration may implement this same port, with persistent
custody and `protection: 'host-managed'`, forwarding through its own approved
protocol. This is a design seam, not a claim that today's connector exposes it.
The host must explicitly select and approve that provider. Wallet connection
alone confers no ACC ownership, read grant, spend grant or storage permission.
`lace-sdk` integration remains outside this milestone.

Encryption, OS keychain integration, extension authentication, trusted provider
identity, cross-origin policy and production hardening are separate work. A
future operation-based key vault (non-exportable sign/decrypt methods) can coexist
with this byte store; do not claim that returning bytes keeps keys non-exportable.

## Verification

The same memory/IndexedDB contract cases cover scoped separation, byte-copy
ownership, concurrent writers, stale deletion, deletion/recreation, invalid input,
provider failure and close. Browser acceptance must additionally use real
IndexedDB. Fake IndexedDB unit tests establish API semantics, not browser quota,
private mode, storage eviction or production security.

Owned-byte copies must also isolate Node Buffer inputs: `Buffer.slice()` aliases
memory. Use a base Uint8Array copy and test both caller mutation and disposal.
