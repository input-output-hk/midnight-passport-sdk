---
layout: default
title: Packages
permalink: /packages/
---

| Workspace package                                        | Purpose                                                                               | Status                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------- |
| `mn-passport-protocol`                                   | Versioned account types, events, errors and service wire types                        | Implemented; private                          |
| `mn-passport-account`                                    | Create, open and rotate flows over injected ports; `./ports` and `./testing` subpaths | Implemented; private                          |
| `mn-passport-adapter-browser`                            | WebAuthn, PRF key recipe, service clients and Midnight chain composition              | Implemented prototype; private                |
| `mn-passport-contract`                                   | Binding registry and integrity loader                                                 | Prototype registry; artefact assembly pending |
| `mn-passport-core`, `connect` and signer/prover adapters | Earlier SDK scaffolding                                                               | Not the current passkey integration surface   |

The package names in source use the development scope `@midnight-ntwrk`. The release design assigns `@input-output-hk/mn-passport-*` for GitHub Packages. Do not copy a future `@input-output-hk` install command into an app until a release appears in the registry.

## Dependency direction

`protocol` has no runtime dependencies. `account` depends on `protocol` and accepts platform services through [`PassportPorts`]({{ '/api/#ports' | relative_url }}). The browser adapter supplies those ports with WebAuthn, the service client and midnight-js. The contract package is intended to supply a pinned ACC binding and its small client artefacts. Prover keys stay outside the npm tarball.

The planned split moves key derivation, WebAuthn, service transport and midnight-js into separate packages before publication. See the [packaging design](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/superpowers/specs/2026-10-07-passport-sdk-packages-design.md) for the target dependency graph.
