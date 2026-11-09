---
layout: default
title: Packages
permalink: /packages/
---

The [problem statement]({{ '/problems/' | relative_url }}) maps ACC distribution, proving keys,
HTTP serving, sponsorship, circuit helpers, faucet funding, and the demo to their package owners.
The nine implemented libraries are the current foundation, browser path, and Node service HTTP
core of the upstream wallet/dApp/agent vision. Contract/compiler helpers and the
`adapter-service/faucet` client already exist in RC7; reserved `core`/`connect`
scaffolds do not provide those capabilities.

## Find the public entry you need

[Runtime and host requirements](#runtime-and-host-requirements) distinguish import
safety from operational support. [Package purposes](#why-rc1-has-13-packages) retain
the historical package-count explanation; [dependency direction](#dependency-direction)
explains composition. The [account API]({{ '/api/' | relative_url }}) lists optional
methods and their required ports. Published examples use exact RC7 versions;
source-preview subpaths below require a matching source build.

## Runtime and host requirements

The nine packages emit ESM with declarations (`type: module`, `types`/`default`
exports). Node 22 is the repository's pinned/tested baseline. Browser support means
the stated APIs/capabilities and bundler composition are available; it does not qualify
every browser/provider version. A successful import or typecheck does not provision
a chain, signer, prover, wallet or persistent store.

| Public entry (`@input-output-hk/mn-passport-…`) | Track / runtime | Host requirements when used |
| --- | --- | --- |
| `protocol` | RC7; neutral types, constants and helpers | Account/service API shapes, not a wallet or transport. |
| `account`; `account/ports`, `/errors`, `/testing`, `/preflight` | RC7; browser or Node with injected ports | Compatible binding, credentials/authorizer, crypto/randomness and chain/backend ports; records before creation. `ports` is types-only; `testing` supplies fakes, not production services. |
| `keys` | Portable key/codec APIs and RC8 owner/session additions | Host-owned secret/PRF origin, crypto/encoding capabilities, explicit byte disposal and checked key lifetime. No automatic vault or native Node passkeys. |
| `contract`; `contract/capabilities`, `/capabilities.json`; `/bindings/acc-s3r1.1` | RC7; metadata/inventory and generated binding are different layers | Pin manifest/compiler/runtime. Generated runtime needs the compatible Compact/Midnight stack; proving keys stay outside npm. See [partner contracts]({{ '/partner-integration/' | relative_url }}). |
| `adapter-webauthn` | RC7 browser WebAuthn/PRF; later source session improvements | Credential API, canonical RP/origin and a qualified provider. Software injection in Node tests is not a native Node authenticator. |
| `adapter-browser` | RC7 browser composition | The above capabilities plus backend ports, Buffer/WASM bundler setup and owned account records. Imports alone do not connect a wallet or start a worker. |
| `adapter-browser/hosted-jubjub` | RC7 optional hosted bridge | Matching host branded values, supported lossless consent mapping and actual host transport. No full Lace compatibility follows from construction. |
| `adapter-service`; `/config`, `/prover`, `/sponsor`, `/deployer`, `/directory`, `/faucet` | RC7; fetch-capable browser/Node | Inject fetch or provide fetch/URL/AbortController/timers. Pin configuration; keep funding/host-job bearer credentials in trusted backend code. Individual clients have distinct budgets and cancellation contracts. |
| `adapter-midnight-js` | RC7 browser/Node adapter | Compatible ledger/Compact/Midnight runtime, provider/binding and proof/fee/value ports. Browser builds need the retained WASM/polyfill configuration; no SSR/React Native qualification. |
| `service` | RC7 Node HTTP/backend library | Node HTTP/filesystem capabilities as selected, authenticated ingress, durable host state and owned chain/wallet/prover setup. Client portability does not make the server browser-compatible. |
| `account/validation`, `/authorization`, `/secret-store`, `/background`, `/names`, `/interaction` | Source after RC7; neutral browser/Node contracts | Per-port admission, consent/custody/lifecycle policy. Background needs a supplied channel/thread, storage is opt-in, interaction starts no effects. |
| `adapter-browser/background`, `/secret-store`, `/wallet` | Source after RC7; explicit browser adapters | Owned Worker/MessagePort, explicitly approved plaintext IndexedDB, or selected wallet provider respectively. None grants ACC authority. |

For the service clients, use the [public-import/protocol table]({{ '/service/#choose-an-http-client' | relative_url }}).
The dedicated `/prover`, `/sponsor` and `/deployer` entries are legacy clients;
`remoteV1*` and the durable host clients are root exports. HTTP route names do not
create additional package subpaths.

CJS/dynamic-import and browser-bundler evidence is tied to the exact installed-consumer
lane/version; there is no separate `require` export family. Do not infer universal
CommonJS loading, server rendering, React Native or real-provider support from ESM
packaging. The [quality guide]({{ '/quality/' | relative_url }}) and
[consumer qualification]({{ '/consumer-integration/' | relative_url }}) name the tested
layers. The optional React host is a [browser development example]({{ '/react-example/' | relative_url }}),
not a foundation dependency or an SSR contract.

## Why RC1 has 13 packages

The RC1 release script packed every publishable directory under `packages/`. That
release had eight implemented libraries and five empty `export {}` scaffolds inherited
from the earlier architecture.
Publishing the scaffolds in `0.1.0-rc1` did **not** deliver five more capabilities. The original
[architecture](https://github.com/midnightntwrk/midnight-passport-sdk/blob/dfdb3f87f2cc2941530ab398e117f46b348fab7f/docs/architecture.md#44-packaging)
pictured a Passport app engine (`core`), a dApp library (`connect`), shared foundations, and platform
adapters. The later, accepted [package decision](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/adr/0007-package-set-ports-and-flows.md)
put account-owner flows and ports in `account`, split the prototype's large browser adapter by
responsibility, reserved `core` and `connect` for later work, and retired three empty adapters.

The table names each package in the source tree. “Active” means it exports an implementation;
it does not mean every feature in the original vision is finished. Only the nine active packages
are packed for RC7.

| Package (`@input-output-hk/mn-passport-*`) | Purpose and place in the vision | Current implementation |
| --- | --- | --- |
| `protocol` | Shared, versioned account API, events, errors, and service wire types. This is the dependency-light contract between hosts and adapters. | Active; types, constants, and pure helpers. |
| `contract` | Versioned ACC binding and artefacts shared by account and chain callers. | Active; `acc-s3r1.1` generated module, registry, integrity manifest, ZKIR/verifier bundle, and key restore CLI. No prover keys in npm. |
| `account` | Platform-neutral account-owner flows and ports. This is the shared foundation a wallet host such as Lace can call directly. | Active; sealed P-256 and JubJub create/open/state, chain-confirmed holdings reads, viewing-secret rotation and device enrollment/removal for both arms, settled grant issue/recovery/revoke/revoke-all for both arms through host ports. Protected original-intent continuation is opt-in and requires durable host composition; actual hosted Lace validation and the wider flow set remain limited. `./ports` and `./testing` support host adapters. |
| `keys` | Platform-neutral key derivation behind the account's key-source port. It holds the recipe so a host need not import browser APIs to derive ACC key material. | Active; Lace-compatible PRF root, JubJub authoriser, passkey reader, and random ACC viewing-secret keyring. |
| `adapter-webauthn` | Browser passkey implementation of the credential, PRF, and authoriser ports. | Active; P-256 WebAuthn arm and passkey PRF used by the JubJub recipe. |
| `adapter-service` | HTTP implementations of proving, sponsorship/submission, deployment, directory, checked-config, and ACC funding clients. It consolidates service calls behind one wire/error mapping. | Active v1 clients. The demo uses them for account flows; `./faucet` calls the separate wallet-backed funding service. |
| `service` | Node HTTP host and injected chain backend port for proof, sponsorship, submission, deployment and account directory handlers. It also verifies and serves a pinned artefact tree. | Active HTTP, artefact and directory core extracted from the demo. Its separate funding route, durable reservation store and unshielded wallet-backend helper are composed by `apps/passport-funding-service`; localnet non-native and exact-value NIGHT ACC deposits have been recorded. A completed request ID replays its result; a pending one requires reconciliation. |
| `adapter-midnight-js` | Chain port that isolates the heavy Midnight runtime from `account` and lets hosts load it when needed. | Active; ledger reads and call pipeline over injected prover, sponsor, and submitter ports, plus a grant source that checks the complete ACC roster, signing nonce, and read-key hashes. |
| `adapter-browser` | Optional browser composition root that wires `account`, passkeys, keys, and the lazy chain adapter; it can install `window.midnight.passport`. | Active; `./prototype` also retains older demo helpers during migration. A host can compose the ports itself. |
| `core` | Intended Passport app engine for grants, private data, recovery, and DID beyond the shared account-owner flows. | Empty scaffold; reserved by ADR 0007. Do not install for RC1 features. |
| `connect` | Intended thin dApp-side grant/connection library, separate from the account-owner API. | Empty scaffold; reserved. The current browser descriptor is an account API, not the finished dApp grant protocol. |
| `adapter-signer-local` | Earlier plan for a local JubJub signer. | Empty scaffold; retired in favour of key providers in `keys`. |
| `adapter-signer-managed` | Earlier plan for a managed-custody signer. | Empty scaffold; retired from this package map. |
| `adapter-prover-remote` | Earlier plan for a remote proving adapter. | Empty scaffold; superseded by `adapter-service/prover`. |

The `service` library was **not** among the 13 RC1 packages: the demo service then lived entirely
under `apps/passport-service`. RC1 therefore had eight implemented packages and five published
placeholders. The current source has extracted the server and chain HTTP handler behind an injected
`ChainBackend`; the demo still owns the wallet, network, key cache and directory. The original
vision also includes higher-level `core`, `connect`, and `agent` entry libraries for the Passport app,
dApps, and agents. A host should not have to import every adapter. The five placeholders are now
private workspace packages and are excluded by both release allowlists, so RC7 packs
nine implemented packages. Existing RC1 package records remain historical artifacts.

## What an integrator installs

Local source after RC7 adds a read-only naming-service port to `account/ports`
and a checked resolver in `account/names`. The mock adapter belongs to the demo;
production providers implement the same port. This adds no package or core
framework dependency. See [naming adapters]({{ '/names/' | relative_url }}).
These exports are not available in published RC7.

Partners may adopt the compiled ACC/assets layer while retaining their own account
orchestration. The [partner contract guide]({{ '/partner-integration/' | relative_url }})
also describes the **RC7** compiler-dependency export and application→ACC
reference. This adds no new npm package; the export is published in RC7, not RC6.

RC7 also adds `contract/capabilities` (lightweight typed inventory),
`contract/capabilities.json` (the same inventory for non-JavaScript consumers), and
`account/preflight` (configuration inspection before a key ceremony). These are subpaths
of existing packages, not new packages. See [capability and configuration checks]({{ '/capabilities/' | relative_url }}); published RC6 does not include them. Use RC7 for these exports.

For a first connection and a minimal browser host, follow [Install and connect]({{ '/getting-started/' | relative_url }}).

The nine RC8 packages use the `@input-output-hk/mn-passport-*` scope on GitHub Packages. Their
`0.1.0-rc8` release uses the `next` distribution tag and requires package read access. Install the
entrypoints your code imports; their declared dependencies bring in the supporting packages. A
browser host using the account API and packaged binding can start with:

```sh
npm install --save-exact @input-output-hk/mn-passport-account@0.1.0-rc8 @input-output-hk/mn-passport-adapter-browser@0.1.0-rc8 @input-output-hk/mn-passport-contract@0.1.0-rc8
```

## Dependency direction

`protocol` has no runtime dependencies. `account` depends on `protocol` and accepts platform services through [`PassportPorts`]({{ '/api/#ports' | relative_url }}). `keys` uses account port types and runtime account helpers for encrypted mutation/deposit
journals; importing a key API is not a guarantee of a type-only account dependency.

Its `recipeEncryptionKey(source)` returns an `EncryptionKeySource` without exposing seed or PRF bytes across that port. It also supplies `recipeJubjubAuthoriser(source, pureCircuits)` for the ACC's PRF-derived JubJub signer, checked against Lace's reference vectors, and `recipeReaderKey(source)` for the per-network X25519 public key that receives sealed account envelopes. The internal device-envelope, coin, grant-record, and view-seal codecs match Lace's wire formats. `recipeDeviceKeyring(source)` implements the `AccountViewingKey` port: random secret creation and delivery, device and grant records, current and recent coin opening, re-encryption, and read-grant sealing. The JubJub account create/open, rotation, and read-grant issue/revoke paths use the authoriser and keyring. The account flow must establish that readers are live on the ledger before asking the keyring to seal to them.

`adapter-webauthn` supplies `CredentialPort`, `PrfKeySource` and the P-256 `Authoriser`. The prototype branch adds `adapter-browser/hosted-jubjub` as a separate subpath for a Lace-style hosted signer, so importing the browser composition root does not load that bridge. `adapter-service` supplies transport ports and the separate funding client; the demo now runs its v1 clients against the service-library routes. `adapter-midnight-js` loads through `import()` when the browser composition root first needs the chain. The prototype's former service chain remains under `adapter-browser/prototype` during migration. `contract` carries the pinned grants ACC module, metadata, ZKIR and verifier bundle. Prover keys stay outside the npm tarball.

The release contract module is a versioned subpath:

```ts
export const binding = () => import('@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1');
```

Pass this lazy module to `createBrowserPassport` with a `NetworkConfig` that pins `bindingId: 'acc-s3r1.1'` and compiler manifest SHA-256 `77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f`. The host also supplies the prover, fee sponsor, deployer and directory ports. The demo service selects `acc-s3r1.1`; its endpoints are described under [Service API]({{ '/service/' | relative_url }}).

See the [packaging design](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/superpowers/specs/2026-10-07-passport-sdk-packages-design.md) for the remaining service and binding work.
