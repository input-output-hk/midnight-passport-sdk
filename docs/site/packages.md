---
layout: default
title: Packages
permalink: /packages/
---

| Workspace package                                        | Purpose                                                                               | Status                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------- |
| `mn-passport-protocol`                                   | Versioned account types, events, errors and service wire types                        | Implemented; private                          |
| `mn-passport-account`                                    | Create, open and rotate flows over injected ports; `./ports` and `./testing` subpaths | Implemented; private                          |
| `mn-passport-keys`                                       | Platform-neutral Lace key recipe and ACC encryption-key source                         | Implemented; private                          |
| `mn-passport-adapter-webauthn`                           | WebAuthn credentials, PRF key source and P-256 authoriser                              | Implemented; private                          |
| `mn-passport-adapter-service`                            | Fetch clients for proving, sponsorship, deployment, directory and checked config      | Client ports implemented; private             |
| `mn-passport-adapter-browser`                            | Midnight chain composition and compatibility exports for the demo                     | Implemented prototype; private                |
| `mn-passport-contract`                                   | Binding registry and integrity loader                                                 | Prototype registry; artefact assembly pending |
| `mn-passport-core`, `connect` and signer/prover adapters | Earlier SDK scaffolding                                                               | Not the current passkey integration surface   |

The package names in source use the development scope `@midnight-ntwrk`. The release design assigns `@input-output-hk/mn-passport-*` for GitHub Packages. Do not copy a future `@input-output-hk` install command into an app until a release appears in the registry.

## Dependency direction

`protocol` has no runtime dependencies. `account` depends on `protocol` and accepts platform services through [`PassportPorts`]({{ '/api/#ports' | relative_url }}). `keys` depends on the account's types-only `./ports` subpath; its `recipeEncryptionKey(source)` returns an `EncryptionKeySource` without exposing seed or PRF bytes across that port. `adapter-webauthn` supplies `CredentialPort`, `PrfKeySource` and the P-256 `Authoriser`. `adapter-service` supplies transport ports; its versioned directory client needs the service-library migration before it can run against the prototype server. The browser adapter still supplies the midnight-js chain. The contract package is intended to supply a pinned ACC binding and its small client artefacts. Prover keys stay outside the npm tarball.

The remaining client split moves midnight-js into a separate package before publication. See the [packaging design](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/superpowers/specs/2026-10-07-passport-sdk-packages-design.md) for the target dependency graph.
