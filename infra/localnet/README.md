# Passport local Midnight stacks

The reference demo's default `undeployed` profile uses
[`docker-compose.yml`](docker-compose.yml) and, on macOS,
[`docker-compose.macos.yml`](docker-compose.macos.yml). Those release-candidate
images and ports `19944/18088/16300` remain the pinned ACC qualification profile.
Keep its existing volumes and private `infra/localnet/.env` credentials.

## Attach to the designated shared Ledger 9 stack

The shared project is `midnight-network`, owned and started by its designated
operator. A Passport consumer can check it without changing Docker state:

```sh
nix develop -c bash scripts/midnight-attach.sh
```

The command checks node `2.1.101`, indexer protocol `2001100`, proof server
`9.0.2`, and the node/indexer block match at the observed height. It prints the
loopback endpoints and observed block hash. Before reusing a deployment record,
verify its **recorded height and block hash** against the live node; the genesis
hash alone cannot distinguish independent development chains. The command is
only a connectivity/version preflight. Use the repo's proof, submission and
indexed-confirmation smoke before claiming a pinned ACC or Midnames build works
on this stack.

For the reference demo, explicitly select `MIDNIGHT_STACK=shared-ledger9` and
provide a **separately funded** sponsor seed via `PASSPORT_SPONSOR_SEED_FILE`,
plus a distinct `PASSPORT_REGISTRY_FILE` for its deployment records. Keep both
absolute paths outside the repository. The public genesis funding wallet may
be in use by another session, and the launcher refuses it on this profile.
Use a separate browser profile for this development chain's local account and
intent storage; keep its original receipts when switching chains.
`prototype-up.sh` attaches without starting or stopping shared containers:

```sh
MIDNIGHT_STACK=shared-ledger9 PASSPORT_SPONSOR_SEED_FILE=/private/seed-file \
  PASSPORT_REGISTRY_FILE=/private/shared-passport-registry.json \
  nix develop -c pnpm demo check
MIDNIGHT_STACK=shared-ledger9 PASSPORT_SPONSOR_SEED_FILE=/private/seed-file \
  PASSPORT_REGISTRY_FILE=/private/shared-passport-registry.json \
  PASSPORT_CONTRACT_DIR=/absolute/path/to/pinned-acc \
  nix develop -c pnpm demo up
```

## Owner-managed current Ledger 9 Compose profile

[`docker-compose.ledger9.yml`](docker-compose.ledger9.yml) is a repo-owned
template for an operator **designated to own** the shared project. It pins
Apple Silicon images by digest and preserves chain/indexer data in named
volumes. Create `infra/localnet/.midnight-indexer.env` from the adjacent
[example](.midnight-indexer.env.example), with fresh independent random
passwords and a hex secret for a new project. Keep the file private and ignored.
Reuse existing credentials when reopening retained volumes. Before starting,
check for an existing project or port owner and coordinate the handoff. The
owner uses the same Compose file and project for lifecycle operations:

```sh
docker compose -p midnight-network -f infra/localnet/docker-compose.ledger9.yml config --quiet
docker compose -p midnight-network -f infra/localnet/docker-compose.ledger9.yml up -d
# Owner shutdown, preserving volumes:
docker compose -p midnight-network -f infra/localnet/docker-compose.ledger9.yml down
```

After startup, the owner runs a representative proof, submission and indexed
confirmation before offering the stack to consumers. Do not remove its volumes
for routine shutdown or version changes.

## Isolated current Ledger 9 qualification

Tests that need a fresh chain use a new `midnight-passport-ledger9-<run-id>`
project and private credentials. Empty `MN_*_PORT` values ask Docker to assign
loopback host ports; discover them for that run before passing URLs to a client:

```sh
project=midnight-passport-ledger9-my-run
export PASSPORT_LOCALNET_PROJECT="$project" MN_NODE_PORT= MN_INDEXER_PORT= MN_PROOF_PORT=
export PASSPORT_INDEXER_ENV_FILE=/private/fresh-indexer-credentials.env
docker compose -p "$project" -f infra/localnet/docker-compose.ledger9.yml up -d
docker compose -p "$project" -f infra/localnet/docker-compose.ledger9.yml port node 9944
docker compose -p "$project" -f infra/localnet/docker-compose.ledger9.yml port indexer 8088
docker compose -p "$project" -f infra/localnet/docker-compose.ledger9.yml port proof-server 6300
```

Use the same project name and Compose file when stopping owned containers;
retain their volumes, deployment records and original receipts. The legacy
profile can also use a fresh `PASSPORT_LOCALNET_PROJECT` without changing its
historical image pins. Never operate another session's project to free ports.
