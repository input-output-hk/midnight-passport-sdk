---
layout: default
title: Packages
permalink: /packages/
---

| Workspace package                                        | Purpose                                                                               | Status                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- |
| `mn-passport-protocol`                                   | Versioned account types, events, errors and service wire types                        | Packed for RC1; unpublished               |
| `mn-passport-account`                                    | Create, open and rotate flows over injected ports; `./ports` and `./testing` subpaths | Packed for RC1; unpublished               |
| `mn-passport-keys`                                       | Portable implementation of Lace's key recipe and ACC encryption-key source             | Packed for RC1; unpublished               |
| `mn-passport-adapter-webauthn`                           | WebAuthn credentials, PRF key source and P-256 authoriser                              | Packed for RC1; unpublished               |
| `mn-passport-adapter-service`                            | Fetch clients for proving, sponsorship, deployment, directory and checked config      | Client ports packed; unpublished          |
| `mn-passport-adapter-midnight-js`                        | Midnight call pipeline over injected prover, sponsor and submitter ports              | Packed for RC1; unpublished               |
| `mn-passport-adapter-browser`                            | Browser composition root and shim; `./prototype` keeps legacy demo helpers             | Packed for RC1; unpublished               |
| `mn-passport-contract`                                   | `acc-s3r1.1` module, binding registry, key manifest, ZKIR and restore CLI             | Both release and prototype bindings packed |
| `mn-passport-core`, `connect` and signer/prover adapters | Earlier SDK scaffolding                                                               | Packed; not the current passkey surface   |

The package names in source use `@input-output-hk/mn-passport-*` for GitHub Packages and npmjs. Wait for a published release before adding an install command to an application.

## Dependency direction

`protocol` has no runtime dependencies. `account` depends on `protocol` and accepts platform services through [`PassportPorts`]({{ '/api/#ports' | relative_url }}). `keys` depends on the account's types-only `./ports` subpath; its `recipeEncryptionKey(source)` returns an `EncryptionKeySource` without exposing seed or PRF bytes across that port. `adapter-webauthn` supplies `CredentialPort`, `PrfKeySource` and the P-256 `Authoriser`. `adapter-service` supplies transport ports; its versioned directory client needs the service-library migration before it can run against the prototype server. `adapter-midnight-js` loads through `import()` when the browser composition root first needs the chain. The prototype's former service chain remains under `adapter-browser/prototype` while its e2e harness migrates. `contract` carries the pinned grants ACC module, metadata, ZKIR and verifier bundle. Prover keys stay outside the npm tarball.

The release contract module is a versioned subpath:

```ts
const binding = () => import('@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1');
```

Pass this lazy module to `createBrowserPassport` with a `NetworkConfig` that pins `bindingId: 'acc-s3r1.1'` and compiler manifest SHA-256 `77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f`. The host also supplies the prover, fee sponsor, deployer and directory ports. The demo service selects `acc-s3r1.1`; its endpoints are described under [Service API]({{ '/service/' | relative_url }}).

See the [packaging design](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/superpowers/specs/2026-10-07-passport-sdk-packages-design.md) for the remaining service and binding work.
