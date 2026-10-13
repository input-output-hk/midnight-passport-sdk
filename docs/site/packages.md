---
layout: default
title: Packages
permalink: /packages/
---

| Workspace package                                        | Purpose                                                                               | Status                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------- |
| `mn-passport-protocol`                                   | Versioned account types, events, errors and service wire types                        | Implemented; private                          |
| `mn-passport-account`                                    | Create, open and rotate flows over injected ports; `./ports` and `./testing` subpaths | Implemented; private                          |
| `mn-passport-keys`                                       | Portable implementation of Lace's key recipe and ACC encryption-key source             | Implemented; private                          |
| `mn-passport-adapter-webauthn`                           | WebAuthn credentials, PRF key source and P-256 authoriser                              | Implemented; private                          |
| `mn-passport-adapter-service`                            | Fetch clients for proving, sponsorship, deployment, directory and checked config      | Client ports implemented; private             |
| `mn-passport-adapter-midnight-js`                        | Midnight call pipeline over injected prover, sponsor and submitter ports              | Implemented; private                          |
| `mn-passport-adapter-browser`                            | Browser composition root and shim; `./prototype` keeps legacy demo helpers             | Implemented; private                          |
| `mn-passport-contract`                                   | Binding registry and integrity loader                                                 | Prototype registry; artefact assembly pending |
| `mn-passport-core`, `connect` and signer/prover adapters | Earlier SDK scaffolding                                                               | Not the current passkey integration surface   |

The package names in source use `@input-output-hk/mn-passport-*` for GitHub Packages and npmjs. Wait for a published release before adding an install command to an application.

## Dependency direction

`protocol` has no runtime dependencies. `account` depends on `protocol` and accepts platform services through [`PassportPorts`]({{ '/api/#ports' | relative_url }}). `keys` depends on the account's types-only `./ports` subpath; its `recipeEncryptionKey(source)` returns an `EncryptionKeySource` without exposing seed or PRF bytes across that port. `adapter-webauthn` supplies `CredentialPort`, `PrfKeySource` and the P-256 `Authoriser`. `adapter-service` supplies transport ports; its versioned directory client needs the service-library migration before it can run against the prototype server. `adapter-midnight-js` uses exact Midnight peer dependencies and loads through `import()` when the browser composition root first needs the chain. The prototype's former service chain remains under `adapter-browser/prototype` while its e2e harness migrates. The contract package is intended to supply a pinned ACC binding and its small client artefacts. Prover keys stay outside the npm tarball.

See the [packaging design](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/superpowers/specs/2026-10-07-passport-sdk-packages-design.md) for the remaining service and binding work.
