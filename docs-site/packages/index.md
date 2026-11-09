# Choose packages by responsibility

All nine published libraries use the private `@input-output-hk/mn-passport-*` scope at exact version `0.1.0-rc8`. Install what your code imports; package dependencies bring supporting layers. The reference demo and service applications are **not** extra SDK packages. [Install and compatibility](/getting-started/installation) covers access and runtime pins.

| Package suffix | What it gives you | Runtime and host requirement |
| --- | --- | --- |
| `protocol` | Public account/service types, events, constants, and API shapes | Framework-neutral ESM; no wallet or transport |
| `account` | Create/open/read and supported mutation flows behind typed ports; `./ports`, `./errors`, `./preflight` and other subpaths | Browser or Node with host key, chain, proof, storage, and consent capabilities |
| `keys` | PRF-derived key recipes, JubJub signer, reader and sealed account material | Host-owned PRF/key source and secret lifetime; no automatic vault |
| `contract` | `acc-s3r1.1` generated binding, integrity registry, public ZKIR/verifiers, capability inventory | Matching Compact/Midnight runtime; independently pinned manifest; prover keys restored separately |
| `adapter-webauthn` | Browser credential, P-256 assertion, and PRF access | Compatible origin/RP ID and passkey provider |
| `adapter-browser` | Optional browser composition root | WebAuthn, WASM/polyfills, records, configured backend; no automatic wallet or worker |
| `adapter-service` | Fetch clients for checked config, directory, deployment, proving, fee sponsorship, and funding | Fetch-capable browser/Node; funding/host-job credentials stay in trusted code |
| `adapter-midnight-js` | Ledger reads and call pipeline for a compatible binding | Chain/indexer, proof, fee/value, and settlement ports |
| `service` | Node HTTP/backend library used by reference services | Operator-owned chain, wallet, key cache, state, and protected ingress |

`core`, `connect`, `agent`, and separate signer scaffolds are not part of the nine-package RC8 release. An importable interface does not imply that every runtime or provider has been qualified. [Public operations](/packages/api) lists method prerequisites; [host integration](/guides/hosts) explains how to replace adapters.

The smallest browser path is [the first integration](/getting-started/first-integration). A wallet host can adopt `account` plus its ports without `adapter-browser`; a contract-only adopter can use `contract` and the [artifact guide](/operations/artifacts).
