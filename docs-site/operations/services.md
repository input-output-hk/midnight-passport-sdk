# Separate proof, fees, and asset funding

## Proving and submission

The Passport service accepts checked configuration, prepares/deploys supported ACC operations, runs proof jobs, and submits final transactions through injected backend ports. The proof service receives operation witness data. Protect ingress, job state, and credentials; use a trusted chain/indexer and pinned binding. A service job may outlive the browser request. Keep its original ID and reconcile its result after a timeout or restart.

### Browser-local proving qualification

The host can supply its own proving implementation. On the isolated Ledger 9
chain, `proof-server-9.0.0-rc.8` proved a transaction prepared against the deployed
`acc-s3r1.1` binding for `append_inbox_with_jubjub`. The fixture stopped the
server and handed the same serialized transaction to a Ledger host that called
a dedicated Chromium worker for proof computation. The worker verified the ACC
key files and k16 public parameters by SHA-256. Its `@midnightntwrk/zkir-v3@3.2.1`
prover rejected the constraints after the circuit check passed. The fixture
exited before proving the DUST fee or submitting the transaction.

The Ledger release's own `zkir-v3-wasm` target builds the workspace's ZKIR
`3.0.0`. That build failed to decode the same pinned circuit's binary ZKIR in
Node and Chromium using a synthetic transaction. The server instead depends on
`midnight-zkir` `3.1.0-rc.1` from the separate ZKIR repository. Pin that dependency
when testing for parity with the server.
[Ledger WASM dependencies](https://github.com/midnightntwrk/midnight-ledger/blob/3361066cc6a899f9dbec02278f189d32b5dbb677/zkir-v3-wasm/Cargo.toml)
[Proof-server dependencies](https://github.com/midnightntwrk/midnight-ledger/blob/3361066cc6a899f9dbec02278f189d32b5dbb677/proof-server/Cargo.toml)

Decoding ZKIR and matching artifact hashes are prerequisite checks. Before
selecting a browser prover, pin the implementation alongside the Ledger
runtime, ACC keys, and public parameters. Run a positive control on the same
input, prove both the contract call and DUST fee with the external prover down,
then verify the original submitted bytes and the expected state change on the
canonical chain. Browser memory, cancellation and supported browser coverage
need separate checks. [Browser proving qualification issue](https://github.com/input-output-hk/midnight-passport-sdk/issues/241)

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
