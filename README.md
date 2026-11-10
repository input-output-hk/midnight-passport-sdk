# Midnight Passport SDK

Start with the [developer documentation](./docs-site/getting-started/index.md): what a
Passport Account Custody Contract is, what the published SDK can do, and which
integration path fits your host. The [documentation workspace](./docs-site/README.md)
builds the VitePress site locally, including local search, diagrams, package guides,
operator paths, and compatibility pages for earlier URLs.

The developer SDK for **Midnight Passport** — the user-facing identity and
wallet layer for the Midnight network. The SDK is the primary programmatic
surface for a user's **Account Custody Contract (ACC)**: onboarding,
authentication, scoped grants, recovery, storage, proving, and the dApp
connector all resolve to authorised interactions with that on-chain account.

> **Status:** `passport-acc-prototype` contains nine implemented SDK packages and three
> backend applications. The `0.1.0-rc9` preview is published as nine private GitHub npm
> packages and three public Linux/amd64 GHCR images. [Release notes](./docs/site/release-notes-rc9.md)
> link the verified hashes, image digests and evaluation limits. [Lace handover](./docs/site/lace-handover.md)
> describes package selection and access. Shielded withdrawals retain the exact-value guard;
> this preview does not claim full Lace compatibility.

> **Passport DApp prototype** (branch `passport-acc-prototype`): a working end-to-end demo on a
> local Midnight network. To run it with Nix, follow the [developer app setup](./apps/README.md); the design and
> flows are in [`docs/prototype/`](./docs/prototype/README.md).

## Documentation

The [SDK documentation site](https://input-output-hk.github.io/midnight-passport-sdk/)
is built from [`docs-site/`](./docs-site/). Choose the path for your task:

| Task | Start here |
| --- | --- |
| Understand Passport and choose a path | [Getting started](./docs-site/getting-started/index.md). |
| Integrate a browser application | [First integration](./docs-site/getting-started/first-integration.md). |
| Select reusable packages or host ports | [Package selection](./docs-site/packages/index.md) and [host integration](./docs-site/guides/hosts.md). |
| Understand keys, wallets and standards | [Architecture](./docs-site/architecture/index.md) and [standards map](./docs-site/architecture/standards.md). |
| Deploy public proving artifacts or services | [Operations](./docs-site/operations/index.md). |
| Run or extend the reference app | [Reference demo](./docs-site/demo/index.md) and [app setup](./apps/README.md). |

The [migration map](./docs-site/MIGRATION.md) and build-generated compatibility pages
keep earlier site paths and heading fragments usable. The former [`docs/site/`](./docs/site/)
sources remain as versioned historical detail. Local edits and previews do not publish Pages.

The [package quality strategy](./docs/site/quality.md) defines coverage, type safety,
worker execution and release gates. [Secret custody](./docs/site/secret-storage.md)
is an optional host seam; its browser reference is explicitly plaintext.

The design lives in [`docs/`](./docs):

- [`sdk-requirements.md`](./docs/sdk-requirements.md) — what the SDK must do, and why.
- [`architecture.md`](./docs/architecture.md) — how it's built: layered core, seams, adapters, worked examples.
- [`development-workflow.md`](./docs/development-workflow.md) — historical harness/workflow design; current repository procedures are in [AGENTS.md](./AGENTS.md) and the [agent runbook](./docs/agent-runbook.md).
- [`beta-scope.md`](./docs/beta-scope.md) — the reduced first version.

Component (`[C…]`) and promise (`[P…]`) references in these docs point to the
Midnight Passport **planning workspace**
([midnightntwrk/passport → `docs/plans`](https://github.com/midnightntwrk/passport/tree/main/docs/plans)),
where the component canvases and promises are maintained.

## Packages

The implemented release packages are private `@input-output-hk/mn-passport-*` packages on GitHub Packages
([ADR 0006](./docs/adr/0006-publish-on-github-packages.md)); the package set, ports
and roles are in [ADR 0007](./docs/adr/0007-package-set-ports-and-flows.md) and the
[packages design](./docs/superpowers/specs/2026-10-07-passport-sdk-packages-design.md):

- `mn-passport-protocol` — the account API, error codes, progress events, service wire types.
- `mn-passport-contract` — the ACC artefact per binding (no prover keys), registry, integrity.
- `mn-passport-account` — the account flows behind ports (`./ports`), fakes and contract suites (`./testing`).
- `mn-passport-keys` — portable derivation, JubJub signing, sealed ACC secrets and device keyrings.
- `mn-passport-adapter-*` — WebAuthn, midnight-js, Passport-service clients, and a browser composition root.
- `mn-passport-service` — implemented Node HTTP, funding-policy and durable reservation primitives.
  Proving/sponsorship, wallet funding and key HTTP serving run as separate backend applications/images.

`core`, `connect`, `agent` and the separate signer scaffold workspaces are excluded from the nine-package RC. JubJub and P-256 authorisation are implemented within the current keys/adapters/account surfaces. See the [package guide](https://input-output-hk.github.io/midnight-passport-sdk/packages/) for authenticated installation.

## Development

Current repository work follows [AGENTS.md](./AGENTS.md), the
[agent runbook](./docs/agent-runbook.md) and [Contributing](./CONTRIBUTING.md).
Use issue-linked coherent review slices, signed commits and the required checks.
The [acceptance index](./docs/local-backlog-acceptance.md) distinguishes current
implementation, observed evidence and remaining delivery.

The [historical workflow design](./docs/development-workflow.md) records the earlier
harness proposal; it grants no current operational or outward-action authority.
Partner documentation uses the [handover policy](./docs/partner-handover.md);
internal run journals are not part of that export.

### Local toolset (Nix)

`nix develop` (or `direnv allow`, via [`.envrc`](./.envrc)) opens a shell with
Node 22, pnpm, the Compact CLI (`compact` 0.5.3), and the Compact toolchain
0.35.0 (language 0.27.0, runtime 0.20.0, ledger 9; ZKIR 3.1 with
`--feature-zkir-v3`), plus `gh`, `jq`, and `mkcert` for a local HTTPS origin.
Toolchain 0.31.1 stays selectable with `compact compile +0.31.1` for historical bindings.
The release binding `acc-s3r1.1` uses Compact 0.35.0 and its independently pinned manifest. The Compact binaries are the official
releases, fetched by hash ([`nix/packages/compact.nix`](./nix/packages/compact.nix));
`COMPACT_DIRECTORY` points `compact` at them.

### Localnet (Docker)

[`infra/localnet/`](./infra/localnet) runs a ledger-9 node, indexer, and proof
server (`midnight-node` 2.1.0-rc.4, `indexer-standalone` 4.4.0-rc.6-b5e6c809
from GHCR, `proof-server` 9.0.0-rc.8, which reads ZKIR 3.1):

```sh
cp infra/localnet/.env.example infra/localnet/.env   # set APP__INFRA__SECRET
docker compose -f infra/localnet/docker-compose.yml up -d
# macOS: add -f infra/localnet/docker-compose.macos.yml
```
