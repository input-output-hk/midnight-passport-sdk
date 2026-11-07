---
layout: default
title: Optional secret storage
permalink: /secret-storage/
---

**Source preview after RC7.** These optional subpaths are absent from published
`0.1.0-rc7`. `SecretStore` is a host custody contract for browser or Node integrations;
it does not persist an existing owner automatically, change PRF derivation, replace
encrypted journals or grant ACC authority. Public prover/verifier artifacts belong
in an artifact cache. The [demo guide]({{ '/demo-guide/' | relative_url }}) describes
its separate memory-only key policy.

## Scope, versions and byte ownership

Import `SecretStore`, `SecretReference` and `StoredSecret` from `account/ports` or
`account/secret-store`. Each record is scoped by `(namespace, networkId, bindingId,
account, id)`. The reference implementations validate nonempty bounded labels,
network/binding values and a lowercase 64-hex account address. Namespace/id labels
are at most 128 characters, start with an alphanumeric character and otherwise allow
alphanumerics plus `._:-`. Validate with `SecretReferenceSchema` at admission.

Methods are asynchronous, except `close()`. Atomicity is **per reference**, without
listing or multi-record transactions. `write(ref, bytes, null)` creates only when
absent; a version string replaces exactly that version. `remove(ref, version)`
removes only that version, treating an absent record as a conflict. Versions are
opaque comparison tokens, not timestamps or authentication capabilities.

Inputs must be nonempty genuine `Uint8Array` values, at most **65,536 bytes**. Stores
copy bytes before their first await, including Node Buffer inputs. Reads and successful
writes return distinct caller-owned copies. The caller clears every returned copy,
including a successful write's result. The store does not clear your original input.
Readonly records do not make their byte arrays immutable, and zeroing an owned array
is not a guarantee of secure memory erasure.

## Complete ephemeral lifecycle

This browser/Node example accepts a reference already bound to a verified account.
It owns the memory store, exercises create/read/remove, and releases every copy even
on failure. An application would use the loaded bytes only inside its checked
private-operation scope; returning their length here avoids exporting the secret.

```ts
import {
  createMemorySecretStore,
  SecretReferenceSchema,
  type SecretReference,
  type StoredSecret,
} from '@input-output-hk/mn-passport-account/secret-store';

export async function ephemeralRoundTrip(reference: SecretReference, input: Uint8Array) {
  const admitted = SecretReferenceSchema.parse(reference);
  const store = createMemorySecretStore();
  let created: StoredSecret | undefined;
  let loaded: StoredSecret | undefined;
  try {
    created = await store.write(admitted, input, null);
    loaded = await store.read(admitted);
    if (!loaded) throw new Error('Expected the newly written record');
    const length = loaded.bytes.byteLength;
    await store.remove(admitted, loaded.version);
    return length;
  } finally {
    loaded?.bytes.fill(0);
    created?.bytes.fill(0);
    store.close();
  }
}
```

A caller that owns `input` must also clear it when its own lifetime ends.
`createMemorySecretStore()` reports `persistence: 'memory', protection: 'none'`.
Replacement, removal and close clear the store's owned records; nothing survives
close or reload. These actions do not revoke on-chain ownership or grants.

## Explicit browser persistence

Call this function only after the host has explicitly approved plaintext storage.
Inject the browser capability; importing the adapter accesses no global database.

```ts
import { createBrowserSecretStore } from '@input-output-hk/mn-passport-adapter-browser/secret-store';

export function openApprovedPlaintextStore(indexedDB: IDBFactory) {
  return createBrowserSecretStore({
    indexedDB,
    databaseName: 'partner-passport-demo',
    allowPlaintext: true,
  });
}
```

This adapter reports `persistence: 'persistent', protection: 'none'`: it stores
**plaintext IndexedDB**, with transactional compare-and-swap. It supplies no encryption,
OS keychain, credential check or production wallet vault. The explicit `true` is
required at runtime as well as in the type. Database names allow 1–128 characters
from alphanumerics and `._:-`. The host owns the handle and must close it at teardown.
Close does not delete database records; use reviewed versioned removals first when
required. Version changes close the handle. A blocked/opening failure is unavailable,
and a late successful open after failure closes its handle.

There is no automatic memory fallback and no timeout or `AbortSignal` parameter.
A host timeout does not establish whether a pending write committed. Re-read and
reconcile versions before attempting a replacement; do not blindly repeat a write
or interpret provider unavailability as absence.

## Outcomes and provider responsibility

| Outcome | Meaning |
| --- | --- |
| `read` returns `undefined` | That scoped record is absent. |
| `SecretStoreError: InvalidInput` | Invalid reference, byte value, version or browser options. |
| `Conflict` | Expected version is stale, or create/delete precondition failed. Re-read and review any changed value. |
| `Unavailable` | Provider failure, blocked database or corrupt stored record; do not replace it with a default secret. |
| `Closed` | Local handle has closed; explicitly acquire a new approved handle if appropriate. |

`SecretStoreError` contains no secret, provider exception text or original cause.
Custom providers must preserve the same scope, copy, atomicity and failure semantics.
A `host-managed` protection capability describes provider-managed custody; it does
not prove a particular security level or imply a prompt on each access. Choose
access, encryption, expiry, deletion and restoration policies explicitly.

A future Lace provider could implement this port through its own approved protocol;
current wallet connection supplies neither storage permission nor ACC authority.
No `lace-sdk` integration is claimed. See
[ADR 0016](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/adr/0016-host-secret-custody.md),
[storage tests](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/tests/secret-store.test.mjs)
and [quality limits]({{ '/quality/' | relative_url }}).
