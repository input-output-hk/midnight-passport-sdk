---
layout: default
title: Prototype service API
permalink: /service/
---

The prototype service runs on `127.0.0.1:8787` by default. It is a development composition, not an authenticated public API. Its wire types are in [`packages/protocol/src/service.ts`](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/protocol/src/service.ts). The reusable Node HTTP host and versioned proving, sponsorship, submission, deployment, directory, and funding handlers are in [`packages/service/src`](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/packages/service/src); the demo supplies its chain backend. The standalone funding process mounts the reusable funding handler; the Passport demo process mounts only a localnet browser proxy for it.

The [service image guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-service/README.md) covers the separate container, mounted ACC export, sponsor seed, and ingress controls.
When container-only `MN_*_URL` endpoints differ from the addresses a browser can reach, set
`PASSPORT_PUBLIC_NODE_URL`, `PASSPORT_PUBLIC_INDEXER_URL`,
`PASSPORT_PUBLIC_INDEXER_WS_URL`, and `PASSPORT_PUBLIC_PROOF_SERVER_URL` on the host. Both config
routes advertise those public addresses while the backend continues using `MN_*_URL`.

The [problem statement]({{ '/problems/' | relative_url }}) separates three server responsibilities: serving pinned proving artefacts, sponsoring eligible ACC calls, and transferring wallet-held assets into an ACC. `mn-passport-service` exports `createServer(config, routes)`, `v1ChainRoute`, `directoryRoute`, `fundingRoute`, `verifyArtefacts`, and `pinnedZkRoute`. An application injects its own wallet, proving provider, policy, network configuration, directory, and funding backend. Verify the pinned tree before listening. The package does not ship the demo's reference-client loader or sponsor seed.

| Route                                | Role                                                                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz`                       | Reports readiness after artefact and sponsor wallet initialization. |
| `GET /config`                        | Reports network, binding, manifest and endpoint configuration. The app checks the manifest against its own build-time pin. |
| `GET /zk/acc/*`                      | Serves the compiled ACC artefacts used by the browser and prover.                                                          |
| `POST /prove-tx`                     | Proves an unproven Midnight transaction with service-held keys.                                                            |
| `POST /sponsor/balance`              | Adds fee inputs only after the sponsor policy accepts the call.                                                            |
| `POST /sponsor/submit`               | Submits a finalised transaction.                                                                                           |
| `POST /deploy`                       | Deploys the ACC in waves and returns its address and submission IDs. `firstArm` is `p256` or `jubjub` (legacy requests default to `p256`). This may take minutes. |
| `/accounts/:networkId/:credentialId` | Stores or reads a passkey-to-account hint. The connector checks it against chain state.                                    |

The sponsor pays **calls to accounts this service deployed and registered**. It refuses offers, Dust actions, non-fee imbalance and deploy or maintenance actions on its public sponsor route. Deployment uses the service's own reference wallet path. The proof preimage reaches the service; a production deployment needs TLS, authentication, rate limits and spending controls. See [prototype limitations](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/prototype/limitations.md).

The demo also serves `/v1/config`, `/v1/zk/{bindingId}/*`, `/v1/accounts/{networkId}/{credentialId}`, `/v1/prove-tx`, `/v1/deploy`, `/v1/sponsor/balance`, `/v1/sponsor/submit`, and `/v1/jobs/{jobId}`. Proving and deployment return a job ID; callers poll progress by cursor. The browser demo uses these routes, with a read fallback to legacy `/accounts` for existing records.

`fundingRoute` defines `POST /v1/faucet/fund` separately from fee sponsorship. A host must supply authentication, a chain-backed deployed ACC check, an asset allowlist with per-request and UTC-day limits, an atomic durable reservation store, and a dedicated wallet backend that waits for an on-chain credit. `createFileFundingStore(path)` is a single-host reference store: it reserves spend in a mode-0600 file before the wallet call and serializes updates with an exclusive lock directory. A crash can leave `<path>.lock`; refuse new funding until an operator checks the wallet and ledger for every pending request and removes the stale lock. Use a transactional database when running replicas. Completed request IDs return their recorded result. An uncertain outcome remains pending; replay returns HTTP 409 until an operator reconciles it. The route is mounted in the standalone funding process, not the demo Passport service. The separate process and its published container image are described in its [operations guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-funding-service/README.md).

`createWalletFundingBackend({ deployed, connect, prepareDeposit? })` is the unshielded deposit implementation over an injected ACC client. `deployed` must read a trusted log of accounts created from the pinned binding; `connect` must use that binding and a funded wallet. The backend serialises wallet calls, verifies `spec_version = 3`, invokes `depositUnshielded`, and waits for the account balance to rise by the requested amount before returning. `apps/passport-funding-service` composes this with the pinned upstream reference client and a separate wallet instance. On the pinned localnet, `prepareDeposit` first makes an exact-value NIGHT self-transfer to avoid the node's change-output fee-budget failure; the optional `preparationTxId` accompanies the deposit `txId`. Other networks require a dedicated wallet and separate NIGHT qualification. The [operations guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-funding-service/README.md) describes the token, asset policy, seed, deployment log and reservation file. Local node-backed non-native and NIGHT deposits into a `spec_version = 3` ACC succeeded; the published `0.1.0-rc5` funding image includes that path and passed a mounted-tree NIGHT deposit and identical-request replay. Pin the digest in [Releasing]({{ '/releasing/' | relative_url }}). The contract package exposes the canonical manifest hash on `resolveBinding(bindingId).manifestSha256`, so the process checks its build pin independently of environment variables.

With `demo up --funding`, the Passport service also exposes `GET /v1/demo/funding` for offered assets and current ACC balances and `POST /v1/demo/funding` for the selected fixed-size deposit. The proxy is localnet and loopback only, requires the demo origin for POST, checks that the ACC was deployed by this demo, and keeps the funding bearer token server-side. It does not expose arbitrary amount selection or a production caller-authentication scheme. See the [engineering handover]({{ '/handover/' | relative_url }}) for the request path and limitations.

`remoteFaucet(base, { headers, fetch?, timeoutMs? })` from `mn-passport-adapter-service/faucet` is the typed caller. Pass a credential callback that returns fresh request headers and retain the same `requestId` after an uncertain result. A completed ID replays its result; a pending ID needs operator reconciliation. Its `FaucetClientError.status` preserves a refusal's HTTP status, with `0` for a transport failure. The client does not generate an idempotency key or keep credentials. A browser host needs an authenticated ingress and CORS policy for its chosen credential header; this client is intended for a trusted backend caller.

## Opt-in host mutation transport

The local unreleased service can enable protected deployment-wave continuation and
owner submission receipts. It requires a dedicated encryption-key file, independent
RPC token file and durable private mount. See [Host durability]({{ '/host-durability/' | relative_url }})
for its authenticated RPC and qualification boundary. Existing v1 job/proving routes
and the default demo composition do not automatically become durable.
