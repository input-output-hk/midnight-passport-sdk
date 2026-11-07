---
layout: default
title: Optional secret storage
permalink: /secret-storage/
---

This local-source API is optional. It does not persist any existing owner key,
change a passkey PRF recipe or replace encrypted journals. A store provides
custody, not ACC authority. Public prover/verifier artifacts do not belong here.

## Portable contract

Import the type from `@input-output-hk/mn-passport-account/ports`.
The scope is `(namespace, networkId, bindingId, account, id)`.
All methods are async. Writes/removals require an expected opaque version;
conflicts are explicit. Reads return owned byte copies that callers dispose.

```ts
import { createMemorySecretStore } from '@input-output-hk/mn-passport-account/secret-store';

const store = createMemorySecretStore(); // browser or Node; ephemeral
const reference = {
  namespace: 'example.partner',
  networkId: 'undeployed',
  bindingId: 'acc-s3r1.1',
  account: verifiedAccount.address,
  id: 'example-secret:v1',
};
const created = await store.write(reference, bytes, null); // create only
try {
  // Use a checked host authentication lease before/after private key operations.
  const next = await store.write(reference, replacementBytes, created.version);
  next.bytes.fill(0);
} finally {
  created.bytes.fill(0);
  store.close();
}
```

`read` returns `undefined` only for an absent key. A provider error is
`Unavailable`; invalid scope/value is `InvalidInput`; stale replacement/deletion
is `Conflict`; a closed local handle is `Closed`. Errors contain no secret or
provider exception cause. Secrets are limited to 64 KiB. `close` does not delete
persistent records or revoke chain ownership/grants.

## Browser reference

```ts
import { createBrowserSecretStore } from '@input-output-hk/mn-passport-adapter-browser/secret-store';

const store = await createBrowserSecretStore({
  indexedDB,
  databaseName: 'partner-passport-demo',
  allowPlaintext: true,
});
```

This is **plaintext IndexedDB**, explicitly reporting `protection: 'none'`.
It supplies asynchronous transactional compare-and-swap, not encryption, an OS
keychain or a production wallet vault. Hardening is deferred by design. Opening
must be a host choice; there is no silent persistence fallback. The demo's
authenticated full-owner key remains in memory and is not written to this store.

## A future Lace provider

A Lace Wallet adapter could implement `SecretStore` with `protection:
'host-managed'` and its own approved communication protocol. The SDK does not
depend on Lace or assume that today's wallet connector supplies storage.
Connecting a wallet grants no ACC authority or storage permission. The host
must explicitly select and approve a provider. `lace-sdk` integration is outside
this milestone.

See [ADR 0016](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/adr/0016-host-secret-custody.md)
for custody, deletion and failure semantics, and [quality strategy](../quality/)
for the contract tests and their limits.
