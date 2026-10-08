# 0007 — The package set: ports and the account owner's flows in `account`

Date: 2026/10/08 · Status: accepted · Amends: architecture §4.4 and §8 decision 2
Refs: [input-output-hk/midnight-passport-sdk#31](https://github.com/input-output-hk/midnight-passport-sdk/issues/31)
(SDK publishing migration, tracking) ·
[#17](https://github.com/input-output-hk/midnight-passport-sdk/issues/17) (progress) ·
[#20](https://github.com/input-output-hk/midnight-passport-sdk/issues/20) (on-chain directory) ·
[#24](https://github.com/input-output-hk/midnight-passport-sdk/issues/24) (two authoriser arms) ·
design: [`2026-10-07-passport-sdk-packages-design.md`](../superpowers/specs/2026-10-07-passport-sdk-packages-design.md)
D-2 to D-12, §1 to §4 · [FS-0.9](../roadmap/specs/M0-Foundations/FS-0.9-acc-artefact-package.md)

## Context

`architecture.md` §4.4 puts the seam interfaces and the flow surfaces in
`mn-passport-core`, with a small `connect` and a recorded `onboard` facade
beside it, and §8 decision 2 says the SDK never owns or compiles the contract.
The prototype built something different, for reasons recorded in
`docs/prototype/architecture.md` §3: four packages (`protocol`, `account`,
`adapter-browser`, `contract`), no kernel, one `adapter-browser` that holds
passkeys, the Lace key recipe, the HTTP clients and the midnight-js chain
pipeline, a P-256 WebAuthn arm only, proving at transaction level, and a
connector it called the "DApp Connector API" although every operation in it
is the account owner's. The SDK realignment proposal (2026-09-25) moves the
shared seams into `mn-passport-account`, so that a dApp or an agent never
reaches `core`.

The first production consumer is
[lace-platform](https://github.com/input-output-hk/lace-platform). Its Passport
module already runs the account owner's flows as plain functions behind its
own seams, and a wallet host such as Lace runs those flows, not only the
Passport app. The SDK has to be generic and small enough at each seam that a
host adopts it because that is less work than keeping its own.

On 2026/10/08 the owner directed, and approved starting the tranches for:

- lace-platform alignment, with generic, embeddable components that follow
  SOLID;
- both authoriser arms, with P-256 the default where the relying party's origin
  fits;
- the Midnight stack configuration as URLs.

Every other decision below is the design's recommendation, taken as the
working baseline.

## Decision

**Package set** (design §1.1). Every package is published as
`@input-output-hk/mn-passport-<name>` (ADR 0006).

| Package               | Single responsibility                                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `protocol`            | The versioned contracts: account API types, descriptor, error codes, progress events, service wire types. Types only.        |
| `contract`            | The ACC artefact per binding, the binding registry, the circuit catalogue, the integrity loader, the ledger projection.      |
| `account`             | The account core: ports (`./ports`), the flows, challenge assembly, directory verification, the deploy planner, `./testing`. |
| `keys`                | Key providers that need no platform API: the Lace key recipe v1, an encryption key source, the JubJub authoriser.            |
| `adapter-webauthn`    | `CredentialPort`, `PrfKeySource` and the P-256 `Authoriser` over the browser's WebAuthn API.                                 |
| `adapter-midnight-js` | The `Chain` port over midnight-js 5; the `Prover`, `FeeSponsor` and `Submitter` ports as midnight-js providers.              |
| `adapter-service`     | HTTP clients for the Passport service, one subpath per port, sharing the wire types and the error mapping.                   |
| `adapter-browser`     | The optional browser composition root, `createBrowserPassport`, and the `window.midnight.passport` shim.                     |
| `service`             | The Passport service as a library: handlers, engine and store ports, the sponsor policy rule set, a reference server.        |

- **Reserved, not specified:** `core`, `connect`, `agent`,
  `adapter-fee-capacity-exchange`, `adapter-prover-wasm`, `adapter-nodejs`,
  `adapter-storage-wpp`, `adapter-recovery`, `adapter-did` and the dApp-code
  registry. `core` will compose `account` and add the Passport app's own
  concerns: grant issuance, WPP, recovery and DID.
- **Retired:** the empty `adapter-signer-local` and `adapter-signer-managed`,
  which the proposal folds into key providers, and the empty
  `adapter-prover-remote`, replaced by `adapter-service/prover`. The proposal's
  `adapter-broadcast` is `adapter-service/sponsor`; both start as subpaths of
  one package because they share one wire, and split when a second backend
  appears.
- **The graph has no cycles.** `protocol` and `contract` depend on nothing,
  `account` only on them, and every adapter only on `account/ports` plus,
  where noted, `contract` or `keys`. `scripts/dependency-graph.mjs` gains the
  edges and `scripts/lint-boundaries.mjs` three rules (see D-6).
- **The contract package ships the artefact.** The ACC source stays the
  contract team's: the SDK pins a revision and never edits it. It compiles the
  pinned revision, and packages the result with its manifest hash committed
  (FS-0.9 D-1 to D-3, D-5), so `architecture.md` §8 decision 2, "the SDK never
  owns or compiles the contract", no longer holds as written. Prover keys are
  not in the package.

**D-2, D-4: ports live in `mn-passport-account/./ports`, shaped as supersets of
lace-platform's seams.**

- The `./ports` subpath is types only. Adapters import it and nothing else
  from the account package, so an adapter gets the interfaces without the
  flows.
- Where a port means what a lace-platform seam means, it uses the same member
  names and accepts a superset of the same shapes, so an existing
  lace-platform object satisfies it by assignment. Ports use method syntax, so
  a host's branded types still fit. The SDK still owns the definition and can
  extend it.
- Every adapter passes its port's contract suite from `account/testing`. A
  compile-time test assigns objects of lace-platform's published seam shapes,
  copied as fixtures, to the ports.
- Storage is two ports with different jobs: `AccountRecordStore` is this
  device's memory of its account; `AccountDirectory` is cross-device discovery.

**D-3: the account owner's flows live in `account`, not `core`.** Create, open,
rotate, and add and remove a device. `core` stays reserved for the Passport
app's own concerns. The `connect` rule is unchanged: `connect` never links
`core`.

**D-7: two authoriser arms behind one `Authoriser` port.** Owner direction
2026/10/07, issue #24.

- **P-256 WebAuthn is the default** where the relying party's origin fits the
  contract's WebAuthn profile. The `wa-json134` profile binds a 21-byte origin,
  and Lace's hosted relying party, `https://passkey.lace.io`, is 23 bytes.
- **JubJub from PRF output #1 is the other arm**, where the origin does not fit.
- The P-256 `Authoriser` lives in `adapter-webauthn`, the JubJub one in `keys`.
  Each arm is a new adapter, not a change to the core.

**D-5: proving is transaction-level only.** `Prover.proveTx` takes the
unproven transaction and returns the proven one, with where the proof ran
(`remote` or `local`), so a host can tell the user. A circuit-level prover joins
through `circuitProverBridge`. The service's `/prove` and `/check` retire.
midnight-js 5 resolves prover keys on the client before a per-circuit prove,
and the 52-circuit ACC has 12.2 GB of prover keys.

**D-6: Midnight packages are exact peer dependencies, reached through
`import()`.** Only three places import Midnight runtime code:
`contract/bindings/*`, `adapter-midnight-js` and `service/midnight`. A build
check refuses a static Midnight import anywhere else, and a scan of each
package's `dist/` repeats it. A host keeps one physical copy of each Midnight
package, which removes the prototype's two-runtimes failure. `protocol`,
`account`, `keys` and `adapter-service` import no `node:` built-in. Nothing is
module-global: midnight-js's network id is set per operation, not at
construction.

**D-8: the account API v1 replaces the prototype's "DApp Connector API"
name.** It is the account owner's surface, versioned in `mn-passport-protocol`
(`PASSPORT_API_VERSION`): `createAccount` and `openAccount`, and a
`PassportAccount` with `state()` and `rotateEncryptionKey()`. A host that
offers it to a page installs a frozen descriptor at `window.midnight.passport`.
A host that embeds the SDK calls `createPassportAccounts(ports)` and never
touches `window`. The dApp-facing connection remains the grant ceremony, a
separate later surface. Errors are one closed list of codes, and a consumer
treats an unknown code as `InternalError`, which is what lets a minor release
add codes. The prototype's names stay as deprecated aliases (T1).

**D-9: progress is a typed event, with request-and-poll for long work.**
`PassportEvent` has three phases (`start`, `end`, `error`) over a closed list of
steps; a consumer ignores steps it does not know. The service reports its share
through jobs: `POST /v1/deploy` and `POST /v1/prove-tx` answer `202 { jobId }`,
and a client polls `GET /v1/jobs/{jobId}?after={cursor}`. A proof waiting
behind a deploy reports its queue position. Polling matches lace-platform's
request-and-poll rule for long work and survives proxies and service-worker
hosts. Server-Sent Events can be added later as a second transport.

**D-10: the service is a library.** Framework-agnostic handlers (`Request` in,
`Response` out) over injectable engines and stores, with the sponsor policy as
an injectable rule set and a reference `node:http` server. A production
operator mounts what it needs in its own server and swaps the sponsor rules
without forking. `apps/passport-service` becomes a composition of it. The
service serves the artefacts of the contract package version it is built with.

**D-11: `retireAuthority` is an explicit choice, with no default.** Retiring
the maintenance authority is irreversible, so `createAccount` requires the
option. The deploy planner treats it as a ceremony-gated action.

**D-12: finding an account goes through an `AccountDirectory` port whose
answers the core always verifies against the chain.** HTTP now, an on-chain
registry next (#20). The verification is the security property, not the source.

**The stack configuration is URLs.** `NetworkConfig` (network id, indexer,
indexer WebSocket and node URLs, artefact URL, binding id and manifest hash) is
a value the host supplies and pins at build time. The service's `/config` is
checked against it and never trusted. There is no fork issue for this yet.

## Consequences

- `architecture.md` §4.4 and §8 decision 2 carry superseded notes pointing here,
  to ADR 0006 and to FS-0.9. Their old text stays, marked, until the
  tranches land.
- The per-seam specs FS-0.3 to FS-0.8 place seam interfaces in `core`. T0 does
  not edit them; reconcile each when its tranche is planned.
- ADR 0001 stands in substance: the self-custody signer is the JubJub PRF
  authoriser, behind the same port. The package it named, `adapter-signer-local`,
  retires; the job moves to `keys`.
- ADR 0005's `onboard` facade is neither reserved nor retired here. Its place
  beside `account` and `core` is for the `core` spec.
- This ADR does not change the `CLAUDE.md` MUST to encrypt the proof preimage
  to the enclave before remote proving. `docs/prototype/architecture.md` §3
  item 12 records the proposal's amended rule, under which the prover sees the
  coin and the amount and the user is told. Reconciling the two is an open
  decision for the owner.
- Tranches T1 to T24 follow the repository's budget (400 net lines soft, 600
  hard). Each names an issue before it is planned. Moves go in PRs of their
  own, with no behaviour change.
- `docs/compatibility.md` carries the two version axes, API and binding.

## Revisit

Design §9 questions that stay open. The working baseline above holds until the
owner answers.

- **Q1.** Flows in `account` (D-3), or wait for a `core` that lace-platform can
  embed.
- **Q2.** Ports in `account/ports` (D-2), or a separate `mn-passport-ports`
  package.
- **Q4.** Transaction-level proving only (D-5): retire `/prove` and `/check` and
  serve circuit-level provers through the bridge.
- **Q6.** One Midnight package set with lace-platform: Lace moves to the SDK's
  set, or the SDK supports Lace's older set for a while, and who decides the
  set per release.
- **Q7.** Which binding comes first: `acc-45721e1` re-pinned as `acc-s<…>r<…>.1`,
  or wait for the caller-pinned grants revision (FS-0.9 OQ-3, OQ-5).
- **Q8.** The deploy: the service-side `Deployer` as the default, or
  client-side over `planDeploy` with the service for a pre-deployed pool (#23).
- **Q9.** The directory's key (#20): `transientHash(domain, rp_id_hash, credentialId)`
  or the P-256 public key under a domain tag, and which arms it must serve.
- **Q11.** Error-code style: PascalCase in the SDK with a mapping for Lace's
  kebab-case, or kebab-case so Lace's codes pass through unchanged.
- **Q12.** Where the per-binding prover-key bundle lives, and whether the service
  rebuilds the keys from ZKIR at start (FS-0.9 OQ-6).
