---
layout: default
title: Packages
permalink: /packages/
---

The [problem statement]({{ '/problems/' | relative_url }}) maps ACC distribution, proving keys,
HTTP serving, sponsorship, circuit helpers, faucet funding, and the demo to their package owners.
The eight implemented libraries are the current foundation and browser path of the upstream
wallet/dApp/agent vision. The planned `service` library and typed circuit/faucet subpaths will be
released when they contain reusable implementations.

## Why RC1 has 13 packages

The release script packed every publishable directory under `packages/`. Eight directories contain
the current SDK surface; five are empty `export {}` scaffolds inherited from the earlier architecture.
Publishing the scaffolds in `0.1.0-rc1` did **not** deliver five more capabilities. The original
[original architecture](https://github.com/midnightntwrk/midnight-passport-sdk/blob/dfdb3f87f2cc2941530ab398e117f46b348fab7f/docs/architecture.md#44-packaging)
pictured a Passport app engine (`core`), a dApp library (`connect`), shared foundations, and platform
adapters. The later, accepted [package decision](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/adr/0007-package-set-ports-and-flows.md)
put account-owner flows and ports in `account`, split the prototype's large browser adapter by
responsibility, reserved `core` and `connect` for later work, and retired three empty adapters.

The table names each released package. “Active” means it exports implementation used by the RC1
browser account path; it does not mean every feature in the original vision is finished.

| Package (`@input-output-hk/mn-passport-*`) | Purpose and place in the vision | RC1 state |
| --- | --- | --- |
| `protocol` | Shared, versioned account API, events, errors, and service wire types. This is the dependency-light contract between hosts and adapters. | Active; types, constants, and pure helpers. |
| `contract` | Versioned ACC binding and artefacts shared by account and chain callers. | Active; `acc-s3r1.1` generated module, registry, integrity manifest, ZKIR/verifier bundle, and key restore CLI. No prover keys in npm. |
| `account` | Platform-neutral account-owner flows and ports. This is the shared foundation a wallet host such as Lace can call directly. | Active; create, open, state, and encryption-key rotation. `./ports` and `./testing` support host adapters. Grants, recovery, and the wider flow set remain future work. |
| `keys` | Platform-neutral key derivation behind the account's key-source port. It holds the recipe so a host need not import browser APIs to derive ACC key material. | Active; Lace-compatible PRF-root recipe and ACC encryption-key source. The planned JubJub authoriser is not in RC1. |
| `adapter-webauthn` | Browser passkey implementation of the credential, PRF, and authoriser ports. | Active; P-256 WebAuthn arm and passkey PRF. Other authoriser arms remain future work. |
| `adapter-service` | HTTP implementations of proving, sponsorship/submission, deployment, directory, and checked-config ports. It consolidates service calls behind one wire/error mapping. | Active clients. Its versioned directory route still needs the planned service-library migration; the demo uses a legacy registry client. |
| `adapter-midnight-js` | Chain port that isolates the heavy Midnight runtime from `account` and lets hosts load it when needed. | Active; ledger reads and call pipeline over injected prover, sponsor, and submitter ports. |
| `adapter-browser` | Optional browser composition root that wires `account`, passkeys, keys, and the lazy chain adapter; it can install `window.midnight.passport`. | Active; `./prototype` also retains older demo helpers during migration. A host can compose the ports itself. |
| `core` | Intended Passport app engine for grants, private data, recovery, and DID beyond the shared account-owner flows. | Empty scaffold; reserved by ADR 0007. Do not install for RC1 features. |
| `connect` | Intended thin dApp-side grant/connection library, separate from the account-owner API. | Empty scaffold; reserved. The current browser descriptor is an account API, not the finished dApp grant protocol. |
| `adapter-signer-local` | Earlier plan for a local JubJub signer. | Empty scaffold; retired in favour of key providers in `keys`. |
| `adapter-signer-managed` | Earlier plan for a managed-custody signer. | Empty scaffold; retired from this package map. |
| `adapter-prover-remote` | Earlier plan for a remote proving adapter. | Empty scaffold; superseded by `adapter-service/prover`. |

The planned `service` library is **not** among the 13 packages: the demo service still lives under
`apps/passport-service`. RC1 therefore has eight implemented packages, five published placeholders,
and no published service library. The original vision also includes higher-level `core`, `connect`,
and `agent` entry libraries for the Passport app, dApps, and agents; RC1 delivers the shared account
foundation and one browser path first. A host should not have to import every adapter. The five
placeholders are now private workspace packages and are excluded by both release allowlists, so
future releases contain the eight implemented packages. Existing RC1 package records remain
historical artifacts.

## What an integrator installs

The 13 packages use the `@input-output-hk/mn-passport-*` scope on GitHub Packages. Their
`0.1.0-rc1` release uses the `next` distribution tag and requires package read access. Install the
entrypoints your code imports; their declared dependencies bring in the supporting packages. A
browser host using the account API and packaged binding can start with:

```sh
npm install @input-output-hk/mn-passport-account@0.1.0-rc1 @input-output-hk/mn-passport-adapter-browser@0.1.0-rc1 @input-output-hk/mn-passport-contract@0.1.0-rc1
```

## Dependency direction

`protocol` has no runtime dependencies. `account` depends on `protocol` and accepts platform services through [`PassportPorts`]({{ '/api/#ports' | relative_url }}). `keys` depends on the account's types-only `./ports` subpath; its `recipeEncryptionKey(source)` returns an `EncryptionKeySource` without exposing seed or PRF bytes across that port. It also supplies `recipeJubjubAuthoriser(source, pureCircuits)` for the ACC's PRF-derived JubJub signer, checked against Lace's reference vectors, and `recipeReaderKey(source)` for the per-network X25519 public key that receives sealed account envelopes. The internal device-envelope codec matches Lace's 192-byte wire format, with authenticated reader tags and zero padding. `recipeDeviceKeyring(source)` now creates a random account secret and sealed deliveries, opens the current envelope to reseal for a joining device, and rotates the secret and roster after checking registrations. The account flow must establish that readers are live on the ledger before asking the keyring to seal to them. The broader `AccountViewingKey` port also calls for inbox opening, re-encryption, and read-grant sealing, which remain pending, as does use in account flows. The account create/open/rotate flow still selects P-256 until #24 is completed; a JubJub authoriser and reader key by themselves do not make the flow interoperable. `adapter-webauthn` supplies `CredentialPort`, `PrfKeySource` and the P-256 `Authoriser`. `adapter-service` supplies transport ports; its versioned directory client needs the service-library migration before it can run against the prototype server. `adapter-midnight-js` loads through `import()` when the browser composition root first needs the chain. The prototype's former service chain remains under `adapter-browser/prototype` while its e2e harness migrates. `contract` carries the pinned grants ACC module, metadata, ZKIR and verifier bundle. Prover keys stay outside the npm tarball.

The release contract module is a versioned subpath:

```ts
const binding = () => import('@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1');
```

Pass this lazy module to `createBrowserPassport` with a `NetworkConfig` that pins `bindingId: 'acc-s3r1.1'` and compiler manifest SHA-256 `77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f`. The host also supplies the prover, fee sponsor, deployer and directory ports. The demo service selects `acc-s3r1.1`; its endpoints are described under [Service API]({{ '/service/' | relative_url }}).

See the [packaging design](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/superpowers/specs/2026-10-07-passport-sdk-packages-design.md) for the remaining service and binding work.
