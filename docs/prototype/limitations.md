# Limitations and production requirements

This page describes demo/host limits. For reusable API contracts and exact runtime
requirements, use the [library guide](../site/library-guide.md) and
[public entry index](../site/packages.md#runtime-and-host-requirements). Source-preview
consent/session/quality work is later than published RC7; dated evidence below keeps
its original scope. A configurable port is not a qualified provider or production service.

This is a localnet preview, with the supported routes and evidence listed in
[the compatibility matrix](../compatibility.md) and [Lace consumer report](../lace-consumer-report.md).
The demo exposes scoped spend grant issue/export/import/spend/revoke, device enrollment/removal,
address recovery, live holdings and unshielded withdrawals. The complete two-browser passkey
ceremony is still a manual qualification step. Read grants need complete chain-backed holdings
and surviving device/grantee openings; unavailable data causes refusal. P-256 read-grant issue
remains a demo integration gap even though the reusable account ports implement it.

Packed SDK/Lace source and localnet tests now cover specific recognition and authorising-only
mutation paths. They do not establish full hosted creation, sealed enrollment, hosted address
recovery or real provider compatibility. Keep the pinned consent scopes in the consumer report.

## Remote proving exposes private inputs to the service

**Prototype.** The client sends the transaction's private proving inputs to the configured
proving service. There is no implemented enclave-encryption boundary. TLS can protect transport,
but does not hide inputs from the service operator. ADR 0007's enclave requirement is an unmet
production design requirement, not protection supplied by this RC. Do not use sensitive real data
with an untrusted proving operator; copied demo traces must exclude private proof inputs.

**Production.** Define and implement the reviewed enclave/attestation and encrypted-input
protocol before claiming operator-blind remote proving. Until then this is an explicit trusted
operator boundary, alongside controlled ingress and caller authentication.

## The registry is an off-chain JSON file

**Prototype.** The service keeps the passkey-to-account mapping in `~/.midnight-passport/registry.json`,
beside `registry.deployments.json`. The legacy registry is local to that service deployment and chain. Current hints use
`/v1/accounts` backed by `${PASSPORT_REGISTRY_FILE}.v1`, with legacy lookup retained. A different service deployment may lack the hint even when the passkey is synced;
a second browser using the same directory can still obtain its hint. The service writes the file with a plain
write-and-rename, with no locking beyond one process. The connector treats it as an untrusted hint
and checks every record against the chain ([flows.md](./flows.md#open)). The records are
write-once, except `deployed` to `active`. There is no proof of possession on `PUT /accounts`.
After an intentional chain reset these records may be stale. Archive and reconcile
original account/transaction evidence before selecting fresh state; ordinary restart
or failed authentication must not delete registries, journals or unknown IDs.

**Production.** Keep the mapping on the ledger, with an identity registry contract (fork issue
[#20](https://github.com/input-output-hk/midnight-passport-sdk/issues/20)), so that a new device
can find an account. An enrolled recoverable passkey can already open a known ACC by address without a
directory hint; it must verify its live device and sealed registration/keyring. Unknown
address discovery and total credential loss remain separate problems. Require proof
of possession on directory writes.

## Recovery depends on enrolled, recoverable reader keys

**Prototype.** Current browser ACCs use a random viewing secret sealed to enrolled passkey-derived
reader keys in ledger inbox envelopes. Rotation preserves recoverable seals for verified surviving
devices and read grantees, and excludes removed readers. See [keys.md](./keys.md). A lost device
can be replaced through another enrolled device or a provider-restored credential with the same
PRF outputs. A public ACC address or envelope alone cannot restore the secret after every enrolled
and recoverable passkey is lost. Older deterministic-key P-256 accounts are refused by the new
browser composition until migrated. Grant openings remain browser-profile-local without backup.

**Production.** Define and qualify recovery/backup policy, provider behaviour, legacy migration and
loss of every enrolled reader. Do not promise seed-phrase recovery or derive the ACC secret from
its address.

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

**Prototype.** Nothing authenticates a caller of `/prove-tx`, `/sponsor/*`, `/deploy` or their `/v1` counterparts. The `/v1/accounts` directory is also unauthenticated; its hints are untrusted and checked against the ACC ledger before use, but another caller could claim an unwritten directory key and cause denial of service. Anyone who
reaches the service can use the sponsor, within the policy ([flows.md](./flows.md#the-services-sponsor-policy))
and the deploy cap. The sponsor policy limits what a transaction may contain. It does not limit who
sends it or how often. The circuit allow-list covers `/check` and `/prove`. `/prove-tx` relies on
the service's key registry, which covers the account bundle only.

**Production.** Authenticated sessions (a signed-in passkey or a dApp credential) on `/prove-tx`,
`/sponsor/*` and `/deploy`. Per-client rate limits. Spending caps per client and per day on the
sponsor.

## Other trust gaps

- **The ledger source is not pinned.** The page takes the indexer and node endpoints from the
  service's `/v1/config`. The artefacts are pinned by hash and the ledger source is not, so a
  compromised service could fake the ledger that the open flow's checks read. **Production:** pin
  the endpoints at build time, as the manifest hash is.
- **Authority retired for good.** The last deploy wave retires the maintenance authority, so a
  deployed account can never be upgraded. That is the irreversible choice the epic's risk 12 asks to
  record. A later decision can keep the authority instead.

## The Dust race

**Historical risk description.** Current source passes one `runExclusive` queue to
versioned proving/deployment/sponsor handlers and legacy routes. This does not establish
atomic distributed reservation across separate balance/submit calls or multiple service
instances. Retain wallet coordination and uncertainty handling; qualify the actual host.

**Earlier prototype.** `/sponsor/balance` and `/deploy` are not coordinated. A balance and a deployment wave
that run together can pick the same Dust coin. The loser fails at submit. No funds are lost, and the
earlier caller retried. Proofs were queued, so they did not overlap a deploy, but balancing was not.
Current hosts must first reconcile the original submission; a transport failure is
not evidence that a replacement is safe.

**Production.** Coordinate the sponsor's Dust use, or give each kind of work its own funded wallet.

## CI coverage

**Current source.** Pull request checks include lint/format, builds and package/application
types, package/application tests, both-arm synthetic Chromium journeys, and browser
worker/IndexedDB contracts. These are not live passkey-provider or native proof
acceptance. Coverage and opt-in native/image/installed-consumer qualification have
separate commands and receipts; see the [quality guide](../site/quality.md).

**Production.** Require the relevant exact-source, packaged-consumer, target-network,
provider and native/image qualification for the composition being deployed. Fast CI
cannot substitute for those boundaries.

## Non-localnet networks are not release-qualified

**Prototype.** The network id and node/indexer/proof URLs are configurable, and services check that
the reference client agrees. Only `undeployed` localnet flows are qualified here. The genesis
wallet default is accepted only on that network; other networks require a dedicated sponsor/funding
seed and explicit asset policy. NIGHT funding is refused outside localnet. Configurability alone
is not testnet readiness.

**Production.** Qualify funded dedicated wallets, target-network endpoints, deployment policy,
persistent state, ingress and transaction outcomes on the actual network before use.

## Also not covered

- **Progress.** The demo exposes connector events and redacted operation request/response traces.
  Long proving/deployment operations can still have coarse progress; inspect transaction evidence
  instead of treating a timeout as proof that nothing was submitted.
- **Lost passkeys and grant-holder use.** The demo supports sealed second devices and scoped
  fixed-recipient unshielded spend grants. Package localnet probes exercise holder spending,
  revoke and post-revoke refusal; the real two-browser passkey ceremony still needs manual
  qualification. Clearing browser storage loses locally journaled openings. Neither address
  recovery nor a grant opening restores a lost owner passkey.
- **Shielded partial spends.** The selected coin must exactly equal the withdrawal amount.
  Durable change recovery and spent-input reconciliation remain #201; full typed coverage of
  all contract circuits remains #82. Outstanding Lace live/value-host evidence remains #202.
- **A wallet of its own.** The built-in wallet is a read-only stand-in. It proves and pays nothing.
  lace-sdk is expected to replace it.
- **Browsers.** Real-passkey runs used Chrome on macOS only.
- **Hardware.** P-256 proofs need about 13.5 GiB on the proof server, so Docker needs at least
  24 GiB. The artefacts take about 12 GB.
- **Wiring into lace-platform.** This fork stays self-contained.

## Device-entry removal boundary (2026/10/20)

`removeDevice(commitmentHex)` removes one opaque ACC set element. It does not
prove that the same signing key has no other current, later-counter or future-epoch
entries. The SDK refuses ambiguous/incomplete rosters and shared target/survivor keys
before delivering new keys; keep those refusals. A successful viewing/roster rotation
excludes the selected reader from that new generation, but cannot erase old secrets
or plaintext. Active read-grant delivery is a separate channel and must be reviewed.

Total-loss recovery is not exposed by the SDK. The pinned `acc-s3r1.1` recovery
finaliser does not clear prior entries; do not use it as a full compromised-device
revocation fallback. Current SDK-created accounts use an unretained birth recovery
key with a zero wrap; an imported account's recovery configuration is unknown to
that create path. Keeping or opening an address does not recover a lost passkey.
See the binding decision and qualification guide for the current supported scope.

### Local host durability work (2026/10/23)

An authenticated opt-in host route can persist original deployment/wave transactions
and maintenance authority material in an encrypted journal. It fences stale senders
and reconciles known identifiers without blind resubmission. This is separate from
the default demo owner path and has offline/process evidence only in this slice.
Docker was stopped; live proof/provider restart acceptance, TTL reconciliation and
lost uncommitted constructor outputs remain explicit limits. See
[host durability](../site/host-durability.md).
