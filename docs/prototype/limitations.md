# Limitations and production requirements

This is a prototype for the standalone network. Each item below says what the prototype does and
what production needs. Two items have fork issues:

- [#17](https://github.com/input-output-hk/midnight-passport-sdk/issues/17): show progress, with
  connector progress events, an event log and a progress bar in the demo.
- [#20](https://github.com/input-output-hk/midnight-passport-sdk/issues/20): keep the
  passkey-to-account mapping on the ledger with an identity registry contract.

## The registry is an off-chain JSON file

**Prototype.** The service keeps the passkey-to-account mapping in `~/.midnight-passport/registry.json`,
beside `registry.deployments.json`. The registry belongs to one machine and one chain. A passkey
synced to another machine finds no account there. The service writes the file with a plain
write-and-rename, with no locking beyond one process. The connector treats it as an untrusted hint
and checks every record against the chain ([flows.md](./flows.md#open)). The records are
write-once, except `deployed` to `active`. There is no proof of possession on `PUT /accounts`.
After a chain reset the file is stale and must be deleted by hand.

**Production.** Keep the mapping on the ledger, with an identity registry contract (fork issue
[#20](https://github.com/input-output-hk/midnight-passport-sdk/issues/20)), so that a new device
can find an account. Until then, discovery on a new device needs a name lookup or a chain scan.
Require proof of possession on writes.

## Rotated encryption keys are random

**Prototype.** The account's first encryption key derives from the passkey ([keys.md](./keys.md)).
A rotation target is 32 random bytes, and nothing keeps a copy. Data encrypted to a rotated key
cannot be recovered. Lace has no rotation recipe yet.

**Production.** A defined derivation for rotation targets, so that every key an account has held is
reproducible from the passkey, or a keeping scheme that survives a lost device.

## The 64-call counter scan limit

**Prototype.** The connector finds the passkey's live device entry by probing use counters 0 to 63
(`RESCAN_LIMIT` in `packages/account/src/connector.ts`). The scan always starts at 0, so an account
allows 64 authorised calls per passkey entry. If the live entry's counter is higher, the connector
reports no entry (`AccountNotFound`) although the account still holds it.

**Production.** A scan that starts from a known counter, or a counter the account exposes.

## The deploy cap

**Prototype.** The service accepts at most 20 `/deploy` requests per process
(`PASSPORT_MAX_DEPLOYS`). Failures count. After that it answers `429`. The count lives in memory and
resets when the service restarts, so it bounds the sponsor's spending only loosely. Deploys and
proofs share one queue that refuses a ninth waiting job with `503`. The queue has no per-job
timeout, so a proof server that never answers wedges it until the service restarts.

**Production.** Durable counters, per-client and per-day spending caps, and a per-job timeout on the
queue.

## Loopback-only binding

**Prototype.** The service binds `127.0.0.1`. A non-loopback `PASSPORT_SERVICE_HOST` exposes the
sponsor to whoever can reach it. CORS lets only the dapp origin read answers, and that does not stop
a cross-site page from sending a request. So the service answers `415` to any `POST` or `PUT`
whose `content-type` is not `application/json`, which forces a preflight, and `421` to any `Host`
that is not `127.0.0.1`, `localhost` or `[::1]` at its port (or the configured host), which defeats
DNS rebinding. The localnet's host ports are also published on `127.0.0.1` only. The demo works
only for a browser on the same machine, at exactly `http://localhost:5173`.

**Production.** TLS in front of the service, and a public origin. The WebAuthn profile `wa-json134`
requires a 21-byte origin, which `http://localhost:5173` is exactly, so a production origin needs a
profile that fits it.

## No authenticated sessions

**Prototype.** Nothing authenticates a caller of `/prove-tx`, `/sponsor/*` or `/deploy`. Anyone who
reaches the service can use the sponsor, within the policy ([flows.md](./flows.md#the-services-sponsor-policy))
and the deploy cap. The sponsor policy limits what a transaction may contain. It does not limit who
sends it or how often. The circuit allow-list covers `/check` and `/prove`. `/prove-tx` relies on
the service's key registry, which covers the account bundle only.

**Production.** Authenticated sessions (a signed-in passkey or a dApp credential) on `/prove-tx`,
`/sponsor/*` and `/deploy`. Per-client rate limits. Spending caps per client and per day on the
sponsor.

## Other trust gaps

- **The ledger source is not pinned.** The page takes the indexer and node endpoints from the
  service's `/config`. The artefacts are pinned by hash and the ledger source is not, so a
  compromised service could fake the ledger that the open flow's checks read. **Production:** pin
  the endpoints at build time, as the manifest hash is.
- **Authority retired for good.** The last deploy wave retires the maintenance authority, so a
  deployed account can never be upgraded. That is the irreversible choice the epic's risk 12 asks to
  record. A later decision can keep the authority instead.

## The Dust race

**Prototype.** `/sponsor/balance` and `/deploy` are not coordinated. A balance and a deployment wave
that run together can pick the same Dust coin. The loser fails at submit. No funds are lost, and the
caller retries. Proofs are queued, so they never overlap a deploy, but balancing is not.

**Production.** Coordinate the sponsor's Dust use, or give each kind of work its own funded wallet.

## CI is suspended

**Prototype.** On 2026/10/07 the owner suspended the pull request checks while the prototype lasts.
The `pull_request` trigger in `.github/workflows/pr-checks.yml` is commented out, and the workflow
can still be run by hand. The checks run locally: `pnpm run lint`, `pnpm run format:check`,
`pnpm test` and `pnpm run test:apps`. The checks that need a localnet and the compiled artefacts
(`PASSPORT_IT=1`, `PASSPORT_CONTRACT_DIR`, `pnpm prototype:e2e`) were never part of the workflow.

**Production.** CI will be redesigned from scratch. It should build the artefacts, run the
integration tests against a localnet, and run the end-to-end script.

## Testnet is not wired

**Prototype.** Only the standalone localnet works. The network id is fixed at `undeployed`. The
reference client hard-codes the localnet endpoints, so the service refuses to start with another
`PASSPORT_NETWORK_ID`, indexer, node or proof-server URL. The sponsor wallet's default seed is the
localnet's public, genesis-funded development seed. LW-15635 itself targets the testnet.

**Production.** A real sponsor key and funding, endpoints for the target network pinned at build
time, and a deployment pipeline for the artefacts.

## Also not covered

- **Progress.** The connector reports five coarse steps, and nothing inside the 180-second deploy.
  See fork issue [#17](https://github.com/input-output-hk/midnight-passport-sdk/issues/17).
- **Beyond the first device.** There is no second device, grant, recovery or withdrawal. Only the
  passkey that created the account can sign for it.
- **A wallet of its own.** The built-in wallet is a read-only stand-in. It proves and pays nothing.
  lace-sdk is expected to replace it.
- **Browsers.** Real-passkey runs used Chrome on macOS only.
- **Hardware.** P-256 proofs need about 13.5 GiB on the proof server, so Docker needs at least
  24 GiB. The artefacts take about 12 GB.
- **Wiring into lace-platform.** This fork stays self-contained.
