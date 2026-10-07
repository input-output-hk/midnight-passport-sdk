# Midnight Passport SDK

The developer SDK for **Midnight Passport** — the user-facing identity and
wallet layer for the Midnight network. The SDK is the primary programmatic
surface for a user's **Account Custody Contract (ACC)**: onboarding,
authentication, scoped grants, recovery, storage, proving, and the dApp
connector all resolve to authorised interactions with that on-chain account.

> **Status:** planning / spec, with a reduced **beta (v1)** defined. This
> repository will host the SDK packages as they are built.

> **Passport DApp prototype** (branch `passport-acc-prototype`): a working end-to-end demo on a
> local Midnight network. To run it with Nix, follow [`AGENTS.md`](./AGENTS.md); the design and
> flows are in [`docs/prototype/`](./docs/prototype/README.md).

## Documentation

The design lives in [`docs/`](./docs):

- [`sdk-requirements.md`](./docs/sdk-requirements.md) — what the SDK must do, and why.
- [`architecture.md`](./docs/architecture.md) — how it's built: layered core, seams, adapters, worked examples.
- [`development-workflow.md`](./docs/development-workflow.md) — the `mn-passport-skills-*` skills that drive development, spec orchestration, and PR / issue traceability.
- [`beta-scope.md`](./docs/beta-scope.md) — the reduced first version.

Component (`[C…]`) and promise (`[P…]`) references in these docs point to the
Midnight Passport **planning workspace**
([midnightntwrk/passport → `docs/plans`](https://github.com/midnightntwrk/passport/tree/main/docs/plans)),
where the component canvases and promises are maintained.

## Packages (planned)

Published under the `@midnight-ntwrk/` scope:

- `mn-passport-core` — kernel, flows, and seam interfaces (wallet / agent side).
- `mn-passport-protocol` — shared C23 wire types (dApp ↔ wallet).
- `mn-passport-contract` — typed ACC bindings over the externally-owned contract artefact.
- `mn-passport-connect` — the thin dApp-side connector.
- `mn-passport-adapter-*` — platform (browser, node) and seam adapters (signer, prover, storage, …).

## Development

Development is spec-driven and harness-assisted — see
[`docs/development-workflow.md`](./docs/development-workflow.md). Every spec is
planned into small, reviewable PRs anchored to a GitHub issue; progress and
backlog are tracked in [`STATE.md`](./STATE.md).

The workflow ships as the **`mn-passport-skills` plugin** in [`mn-passport-skills/`](./mn-passport-skills):
ten skills (`/mn-passport-skills:spec-author`, `/mn-passport-skills:spec-driver`, the four review
lenses, `doc-sync`, `pr-open`, and the `deps` / `devenv` watchers), a PreToolUse
hook that stops
outward actions for human confirmation, and the scripts behind the CI gate
([`.github/workflows/pr-checks.yml`](./.github/workflows/pr-checks.yml)).
Claude Code auto-enables it when you trust the repo (via
`.claude/settings.json`); manual fallback:
`/plugin marketplace add .` then `/plugin install mn-passport-skills@midnight-passport-sdk`.

Prerequisite: the private residual-risk register repo cloned as a sibling at
`../mn-passport-sdk-debts` (checked by `/mn-passport-skills:devenv`).

### Local toolset (Nix)

`nix develop` (or `direnv allow`, via [`.envrc`](./.envrc)) opens a shell with
Node 22, pnpm, the Compact CLI (`compact` 0.5.3), and the Compact toolchain
0.35.0 (language 0.27.0, runtime 0.20.0, ledger 9; ZKIR 3.1 with
`--feature-zkir-v3`), plus `gh`, `jq`, and `mkcert` for a local HTTPS origin.
Toolchain 0.31.1 stays selectable with `compact compile +0.31.1`: it is the one
[`acc-versions.generated.json`](./packages/contract/acc-versions.generated.json)
records for the prototype binding. The Compact binaries are the official
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
