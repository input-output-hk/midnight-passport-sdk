# Separate proof, fees, and asset funding

## Proving and submission

The Passport service accepts checked configuration, prepares/deploys supported ACC operations, runs proof jobs, and submits final transactions through injected backend ports. The proof service receives operation witness data. Protect ingress, job state, and credentials; use a trusted chain/indexer and pinned binding. A service job may outlive the browser request. Keep its original ID and reconcile its result after a timeout or restart.

### Browser-local proving qualification

On an isolated Ledger 9 chain, a dedicated Chromium worker proved a live
`append_inbox_with_jubjub` call against `acc-s3r1.1` and the wallet's DUST fee
after `proof-server-9.0.0-rc.8` stopped. A Node host assembled and submitted the
transaction, then matched its bytes to the canonical finalized record. The
account recorded one inbox append. The worker checked artifact SHA-256 hashes
and used k16 parameters for the ACC proof and k13 for DUST. In that run the
two proofs took about 123 and 10 seconds respectively. The fixture observed
zero remote browser requests during proving.

The ACC proof used WASM built from `midnight-zkir` `3.1.0-rc.1` at the source
revision pinned by the proof server. The DUST proof used `@midnightntwrk/zkir-v2`
`2.2.0`. In an earlier live run, the server accepted the same input handed to
`@midnightntwrk/zkir-v3@3.2.1`, which decoded the circuit and rejected the
proof constraints. [ZKIR source pin](https://github.com/midnightntwrk/midnight-zkir/tree/e82d81d25aabcc5f5092e2bd559083487f577914)

The Ledger release's own `zkir-v3-wasm` target builds the workspace's ZKIR
`3.0.0`. That build failed to decode the same pinned circuit's binary ZKIR in
Node and Chromium using a synthetic transaction. The server instead depends on
`midnight-zkir` `3.1.0-rc.1` from the separate ZKIR repository. Pin that dependency
when testing for parity with the server.
[Ledger WASM dependencies](https://github.com/midnightntwrk/midnight-ledger/blob/3361066cc6a899f9dbec02278f189d32b5dbb677/zkir-v3-wasm/Cargo.toml), [proof-server dependencies](https://github.com/midnightntwrk/midnight-ledger/blob/3361066cc6a899f9dbec02278f189d32b5dbb677/proof-server/Cargo.toml)

The source candidate also has an opt-in Ledger 9 transaction proving worker.
In a production Chromium bundle it deserialized a synthetic signed JubJub
inbox append and returned the proved transaction. The browser received the
unproven bytes, then performed Ledger proving and proof computation in the
worker. The fixture observed only local GET requests for its code and public
artifacts. A separate live run used the same production worker for the ACC
proof and the earlier Chromium fixture for DUST. The Node host submitted once
and confirmed the original bytes and one inbox append at canonical finality.
Both proof workers ran with the external proof server stopped. [Worker integration](/guides/hosts#browser-worker-proving-in-the-source-candidate)

The demo continues to use its configured proof service. Browser-hosted
call construction, DUST assembly, artifact delivery, other circuits, memory
and browser support need separate checks. When choosing a prover, pin the
implementation alongside the Ledger runtime, keys and public parameters. Run
a positive control on the same input and confirm the canonical state change
after proving with the external server down. [Browser proving qualification issue](https://github.com/input-output-hk/midnight-passport-sdk/issues/241)

## Fee sponsorship

The sponsor wallet adds **fee inputs** to eligible account transactions after policy checks. It is not the person's wallet and does not move the asset being withdrawn or deposited. The reference policy restricts eligible account calls and refuses offers or unbalanced value actions on its public route. A caller still needs the value-capable path for an asset withdrawal.

## Funding

The funding service owns a **different wallet** that sends allowed assets into an eligible deployed ACC. It requires authenticated backend access, allowlists, request/day limits, and a durable reservation keyed by the original request ID. Completed IDs can replay their result; pending/unknown IDs require reconciliation before another send. Keep its bearer token out of browser storage and bundles. The demo's local funding proxy is a bounded evaluation path, not a production authentication design.

For exact routes and configuration, use the [service source guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc9/docs/site/service.md) and [funding app guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-funding-service/README.md). [The release receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc9/rc9-publication-receipt.json) identifies the published images. No SDK package installation provisions the node, proof server, fee wallet, or asset wallet.

## Wallet identity, state and ports

Run concurrent fee-sponsor and asset-funding services with distinct funded wallet
seeds and separate persistent wallet state. On the standalone network both
unconfigured defaults choose the public genesis seed; that default is for one
active wallet at a time in sequential qualification. The reference demo CLI
forwards `PASSPORT_FUNDING_SEED_FILE` for a separately provisioned funding wallet.
A shared, read-only deployment-log directory is separate from either wallet’s state.

Direct Docker mappings must preserve the configured port. For example, changing
the public service port to 18790 also requires `PASSPORT_SERVICE_PORT=18790` and
`-p 127.0.0.1:18790:18790`. The funding setting is `PASSPORT_FUNDING_PORT`. A
mismatched mapping gets HTTP 421 from the Host/local-socket check; keep that check
in place. A trusted reverse proxy must deliberately supply the correct upstream
authority and enforce its own authentication and limits.
