---
layout: default
title: HTTP service integration
permalink: /service/
---

The reusable Node host accepts your routes, chain backend, wallets and policy.
The reference demo composes it into local development services. Package
integration and that app's endpoints have different responsibilities; start with
the [library guide]({{ '/library-guide/' | relative_url }}) or
[demo guide]({{ '/demo-guide/' | relative_url }}) for your task.

## Reusable Node host

`mn-passport-service` supplies `createServer(config, routes)`, `v1ChainRoute`,
`directoryRoute`, `fundingRoute`, `verifyArtefacts` and `pinnedZkRoute`. Your host
injects the wallet, proving provider, network pins, authentication, policy,
directory and funding backend. Verify the pinned artifact tree before listening.
The package supplies neither the demo's reference-client loader nor its sponsor
seed. [Problems and boundaries]({{ '/problems/' | relative_url }}) distinguishes
artifact serving, fee sponsorship and funding an ACC from wallet-held assets.

The browser/Node `adapter-service` clients implement the corresponding remote
ports. Use the versioned job clients for asynchronous proof/deploy progress,
[durable host ports]({{ '/host-durability/' | relative_url }}) for explicit original-ID
reconciliation, and the faucet client below for the separate funding service.
Choosing a client does not configure an authenticated ingress or durable backend.

## Choose an HTTP client

Import entries below use the full prefix `@input-output-hk/mn-passport-`.
The root `adapter-service` exports all these clients. Its dedicated `/prover`,
`/sponsor` and `/deployer` entries expose the **legacy** clients, not aliases for
`remoteV1*`. Wire routes such as `/v1/jobs` and `/v1/mutations` are not public
package import subpaths.

These names are available in RC7. The deadline/body behavior identified as source
preview below is later hardening; it is not installed by upgrading a host's
configuration while keeping RC7 package bytes.

| Public import entry / client | Wire protocol | Current observation budget | Caller signal / progress | Retry and recovery |
| --- | --- | --- | --- | --- |
| `adapter-service`: `remoteV1Prover`, `remoteV1Deployer` | One `POST /v1/prove-tx` or `/v1/deploy`, then cursor `GET /v1/jobs/{id}` | Source preview: 600,000 ms total; 250 ms poll interval | Flow `signal` and validated synchronous `onEvent` | Only failed GET transport is retried, up to three times at the same cursor. No POST replay; a lost deployment acceptance may hide already-started work. |
| `adapter-service`: `remoteV1Sponsor` | Synchronous `POST /v1/sponsor/balance` and `/v1/sponsor/submit` | Source preview: no default deadline; an explicit timeout bounds the whole observation, including body and result projection | No caller signal/progress forwarding | One POST, no automatic retry or durable query. Observation failure does not establish no submission. |
| `adapter-service`: `remoteHostMutationPorts` | `POST /v1/mutations/execute` and same-ID `/reconcile` | Source preview: 600,000 ms total; 250 ms poll interval | Caller signal; no progress callback | No transport POST retry. Valid unknown can continue through original-ID reconciliation, which may finish approved preparation. See [host durability]({{ '/host-durability/' | relative_url }}). |
| `adapter-service`: `remoteHostJobs`, `remoteHostJobPorts` | Durable `/v1/host-jobs` descriptors, status and explicit resume | 600,000 ms invocation; 10,000 ms per request; 250 ms poll interval | Caller signal; `onSnapshot` shares the invocation budget | GET is read-only; no automatic POST retry or legacy fallback. Preserve the original identity. See [service jobs]({{ '/service-jobs/' | relative_url }}). |
| `adapter-service/prover`, `/deployer`, `/sponsor`: `remoteProver`, `remoteDeployer`, `remoteSponsor` | Legacy `/prove-tx`, `/deploy`, `/sponsor/*` | Prover defaults to 600,000 ms; deployer/sponsor have no default timeout. Explicit fetch abort does not bound an uncooperative body | Deployer checks pre-abort only; no active caller-signal/progress forwarding | No automatic retry. Use the matching server protocol and reconcile uncertain effects. |
| `adapter-service/config`: `fetchCheckedConfig`, `fetchCheckedV1Config` | `GET /config` or `/v1/config` | Source preview: 30,000 ms whole read and 65,536 bytes | No caller signal/progress option | No automatic retry. Reacquire under the same trusted pins; a discovery result is not transaction evidence. See [config admission]({{ '/api/#source-preview-checked-configuration-contract' | relative_url }}). |
| `adapter-service/faucet`: `remoteFaucet` | `POST /v1/faucet/fund` | Source preview: no default deadline; an explicit timeout covers credentials, encoding, POST, body and projection | Fresh header values from a captured callback; no caller signal/progress option | Retain the caller's request ID. Completed IDs return recorded results; pending uncertainty requires operator reconciliation. |

The total-budget and body-ownership contracts are per client, not a library-wide
HTTP default. Generic V1 proof results have no universal byte ceiling; the raw
mutation and host-job protocols have their own receipt limits. Fetch-capable Node
and browser imports still need the corresponding runtime capabilities and trusted
service. Keep funding/host-job tokens in a trusted backend or BFF; browser
importability does not authorize embedding bearer credentials in a public page.

## Reference demo composition

The prototype service runs on `127.0.0.1:8787` by default. It is a development composition, not an authenticated public API. Its wire types are in [`packages/protocol/src/service.ts`](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/protocol/src/service.ts). The reusable Node HTTP host and versioned proving, sponsorship, submission, deployment, directory, and funding handlers are in [`packages/service/src`](https://github.com/input-output-hk/midnight-passport-sdk/tree/passport-acc-prototype/packages/service/src); the demo supplies its chain backend. The standalone funding process mounts the reusable funding handler; the Passport demo process mounts only a localnet browser proxy for it.

The [service image guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-service/README.md) covers the separate container, mounted ACC export, sponsor seed, and ingress controls.
When container-only `MN_*_URL` endpoints differ from the addresses a browser can reach, set
`PASSPORT_PUBLIC_NODE_URL`, `PASSPORT_PUBLIC_INDEXER_URL`,
`PASSPORT_PUBLIC_INDEXER_WS_URL`, and `PASSPORT_PUBLIC_PROOF_SERVER_URL` on the host. Both config
routes advertise those public addresses while the backend continues using `MN_*_URL`.

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

The RC6 preview service can enable protected deployment-wave continuation and
owner submission receipts. It requires a dedicated encryption-key file, independent
RPC token file and durable private mount. See [Host durability]({{ '/host-durability/' | relative_url }})
for its authenticated RPC and qualification boundary. Existing v1 job/proving routes
and the default demo composition do not automatically become durable.

### Request-target validation

RC7 refuses malformed request targets with a generic `400` before
routing or wallet/prover work. Only origin-form paths are accepted; proxy-style absolute
URLs and network-path authorities are unsupported. Host validation still runs first (`421`
for an unknown Host). Raw-socket regression checks that malformed requests cannot terminate
the process and that the same instance continues serving health requests. This corrects
#260; released RC6 predates this fix, which is included in RC7.

## HTTP route failures and diagnostics

The service accepts origin-form paths only. It refuses literal fragments (including an empty
`#`), authority-form targets, backslashes in the path, and paths that normalise to a leading
`//` before routing. Host and JSON-body guards still run first; query bytes are preserved for
routes. A failure after response headers are sent destroys that response: clients may observe a
connection reset or incomplete body, and must reconcile an uncertain mutation's original ID.
The server cannot replace an already-started stream with a JSON error.

Unexpected route errors return generic `500` JSON. Applications may set
`onRouteError({ status, headersSent })` in `createServer`'s configuration to record these explicit
redacted facts. The callback receives no error text, request URL, body, header, or wallet state.
Synchronous callback throws and asynchronous rejections are isolated; the server never awaits
telemetry, so a stalled callback cannot delay the response. Expected `HttpError` messages remain the route's
public API; route implementations must keep those messages safe to disclose.


## RC8: V1 job observation lifetime {#source-preview-v1-job-observation-lifetime}

After RC7, `remoteV1Prover`, `remoteV1Deployer` and `requestV1Job` use one
monotonic deadline for the original POST, response bodies, cursor polls and
backoff. `timeoutMs` defaults to **600,000 ms**; `pollIntervalMs` defaults to
**250 ms**. Timeouts accept integers 1–2,147,483,647; polling accepts
0–2,147,483,647. Invalid values refuse before dispatch. Prover/deployer factories
capture their fetch and polling options at construction; editing that options
object later does not redirect a call. Throwing option getters can therefore fail
at construction rather than on the first invocation.

A cooperative fetch is not required for caller settlement: expiry/abort races
headers and body observation, cancels/releases the owned native reader best
effort, and disposes late-arriving bodies. Underlying custom promises or
synchronous host code cannot be forcibly stopped. Owned timers are cleared when observation ends. Caller-listener detachment is
best effort if a custom provider refuses cleanup; any retained callback becomes
inert. Cleanup throws/rejections cannot discard an accepted receipt or replace the
primary typed failure. Late work cannot emit progress or start another poll.

The original prove/deploy POST is sent once. Only a failed GET transport can be
retried, at the same job ID/cursor, up to three retries. Malformed answers, invalid
cursors/states and caller interruption are not transport retries. The complete
public event batch is validated before any callback or cursor advancement.
Callbacks keep their synchronous ordering; returned async rejections are observed,
but async callbacks are not awaited as part of job completion.

Caller cancellation uses `Aborted`; deadline/unreachable observation retains
`ProverUnavailable` or `SponsorRejected` for its role. These codes do not prove
that deployment had no effect. A lost acceptance can hide a job ID even though
work started. Never replay a deployment POST merely because observation failed.

Generic V1 result/event types still have no universal byte ceiling. Hosts must
choose trusted services and enforce their own resource limits; custom `json()`
allocations and blocking JavaScript are outside caller-deadline preemption. The
8 MiB service request cap does not establish a maximum proof result. This slice
does not silently truncate larger custom-host replies.

These changes concern versioned job clients. The synchronous sponsor has the
separate explicit-timeout contract below; legacy `postService` remains unchanged.
The [raw durable mutation observation contract]({{ '/host-durability/#source-preview-original-id-observation' | relative_url }})
has a different receipt policy and no transport POST retry.

## RC8: explicit sponsor timeout {#source-preview-explicit-sponsor-timeout}

After RC7, `remoteV1Sponsor(base, options)` captures `fetch` and `timeoutMs` when
constructed. It does not poll or read `pollIntervalMs`. With no timeout, its
balance/submit methods retain the legacy `postService` path: no implicit budget,
request signal or response cap. Supplying a timeout selects the bounded path;
it must be an integer from **1 to 2,147,483,647 ms**. Invalid values reject as
`InternalError` before a POST, rather than selecting the unset branch.

The explicit budget covers transaction encoding, the single POST, headers,
body/JSON and result projection together. It settles even if injected fetch or
JSON promises ignore abort. The adapter aborts its wire signal and cancels/releases
owned native readers best effort; late bodies and rejecting cleanup cannot replace
the settled outcome. It adds no response-size ceiling. Custom JSON allocations,
blocking JavaScript and backend computation remain outside forced cancellation.

An already observed non-200 status keeps its normal HTTP error classification if
optional diagnostics stall until expiry. Missing-header/success-body expiry uses
`InternalError`; non-200 responses retain `serviceFailure` mapping, including
`SponsorRejected` for 403/429/5xx. Host code should use typed codes and redact any
provider cause before logging. No caller `AbortSignal` or progress callback is
added to this synchronous sponsor API.

Submit observation failure does not prove the transaction was not broadcast.
This client retries no POST and supplies no durable ID/query endpoint. Preserve
available transaction evidence and reconcile through the chosen backend/chain;
do not repeat balance/submit merely because waiting ended. This RC8
correction does not change legacy `remoteSponsor`/`postService`, host jobs,
configuration reads or published RC7 package bytes.

## RC8: funding intent and observation {#source-preview-funding-intent-and-observation}

After RC7, `remoteFaucet` captures its fetch, timeout and credential callback at
construction, retaining the callback's original receiver. Every explicit `fund`
call still requests fresh header values. Before any credential callback or await,
it captures the seven request fields and validates the canonical lowercase UUID,
64-character lowercase hex pins/account/asset, string network/binding and positive
canonical decimal Uint128 amount. The amount is bounded to 39 digits before range
comparison. Invalid local input rejects with `FaucetClientError.status === 0`;
it is not an HTTP 400 response. The client never generates a replacement ID.

The wire and response check use that captured original request ID even if the
caller's object changes while credentials or the service are pending. A successful
response is a new owned record with validated ID, nonempty provider transaction ID,
positive Uint128 credited balance and an optional string preparation transaction ID.
Unknown fields are not forwarded. Credited balance is the resulting ACC balance,
not the deposit amount or an independently verified balance delta. Chain-backed
credit and durable idempotency remain the server/backend's responsibility.

No timeout means no hidden timer, wire signal or response cap. An explicit integer
**1–2,147,483,647 ms** bounds the whole invocation, including fresh credentials,
request preparation, the single POST, body and result projection. If credentials
finish after expiry, no POST follows. Underlying callbacks/promises, blocking
JavaScript and remote transactions cannot be forcibly cancelled; readers and
late bodies are disposed best effort. This adds no caller-signal API or body cap.

Funding retains its own error contract rather than the sponsor's: credential/fetch
failure has status `0`; failed JSON observation after timely headers retains the
known HTTP status and invalid-JSON message. Parsed refusals retain their HTTP
status/message, and successful `response.ok` replies are validated against the
original ID. An HTTP status on an observation error is not proof of no deposit.
Preserve the ID and available transaction evidence, then use the operator's
reconciliation policy. There is no automatic POST retry, fallback, new ID, pending
reservation release or background reconciliation. Published RC7 predates these
client hardening changes; the funding route, wallet policy and journals are unchanged.

## Source preview: optional funding inventory port (after RC8)

`createWalletFundingBackend` accepts an optional `inventory` callback returning
`FundingInventory`: a synchronized observation and a map of spendable unshielded bigint balances.
The host must bound this read and use the same wallet/network as the deposit path. The backend
copies and validates the observation inside its serial queue, before preparation or deposit.
The reference funding app opts in; existing hosts without this callback keep their previous
behavior. Public `fundingInventory` validates observations; `FundingPreflightError` carries only
fixed `FundingAssetUnavailable`/`FundingWalletUnavailable` diagnostics.

`fundingRoute` returns a proved inventory refusal only after its progress callback durably
records `no-submit` and the store releases/tombstones the request. Failed persistence and generic
wallet exceptions retain unknown semantics. An old pending request is never executed again or
retrospectively classified from today's balance. Logs include only request ID, last durable
stage and a fixed code. The optional inventory contract is source preview, absent from RC8.
