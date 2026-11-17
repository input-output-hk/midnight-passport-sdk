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
loopback endpoints and observed block hash. The demo launcher creates a private
`.chain-active.json` run marker before opening the sponsor wallet or service.
After its service process tree stops, it reattaches and advances the private
`.chain-anchor.json` to the final indexed block, then removes the marker. A
crash, failed sponsor drain, lingering process, failed reattach, or failed finalization leaves the
marker in place and refuses future reuse until the original records and chain
are reconciled. This catches a chain rollback after a recorded deployment or
activation, even if the initial anchor block still exists. Existing registry,
directory or deployment files without an anchor are also refused. The attach command itself
is only a connectivity/version preflight. Use the repo's proof, submission and
indexed-confirmation smoke before claiming a pinned ACC or Midnames build works
on this stack.

For the reference demo, explicitly select `MIDNIGHT_STACK=shared-ledger9` and
provide a distinct `PASSPORT_REGISTRY_FILE` for its deployment records. The
shared local development stack uses the public, pre-funded genesis sponsor seed
when no sponsor seed is configured. Coordinate exclusive use of that wallet
across sessions before sending transactions. The shared demo claims the same
stable native sponsor lease as the Midnames bootstrap before opening its wallet;
it releases the lease only after a successful service drain and final chain
anchor. A failed or unknown drain retains the lease for reconciliation. A separately funded wallet can be
selected with `PASSPORT_SPONSOR_SEED_FILE` or `PASSPORT_SPONSOR_SEED`.
Keep private files at absolute paths outside the repository. Create a dedicated private directory
for the registry; the launcher refuses the default registry directory, linked
files and preexisting unanchored records. The public genesis funding wallet may
be in use by another session; the attach preflight does not establish wallet
exclusivity.
Use a separate browser profile for this development chain's local account and
intent storage; keep its original receipts when switching chains.
`prototype-up.sh` attaches without starting or stopping shared containers:

```sh
install -d -m 700 "$HOME/.midnight-passport/shared-ledger9"
MIDNIGHT_STACK=shared-ledger9 \
  PASSPORT_REGISTRY_FILE="$HOME/.midnight-passport/shared-ledger9/registry.json" \
  nix develop -c pnpm demo check
MIDNIGHT_STACK=shared-ledger9 \
  PASSPORT_REGISTRY_FILE="$HOME/.midnight-passport/shared-ledger9/registry.json" \
  PASSPORT_CONTRACT_DIR=/absolute/path/to/pinned-acc \
  nix develop -c pnpm demo up
```

## Owner-managed current Ledger 9 Compose profile

[`docker-compose.ledger9.yml`](docker-compose.ledger9.yml) is a repo-owned
template for an operator **designated to own** the shared project. It pins
Apple Silicon images by digest and preserves chain/indexer data in named
volumes. Create `infra/localnet/.midnight-indexer.env` from the adjacent
[example](.midnight-indexer.env.example), with fresh independent random
passwords and a hex secret for a new project. Copy with a restrictive mode;
ordinary `cp` can leave credentials readable by other local users. Keep the
file private and ignored.
Reuse existing credentials when reopening retained volumes. Before starting,
check for an existing project or port owner and coordinate the handoff. The
owner uses the same Compose file and project for lifecycle operations:

```sh
install -m 600 infra/localnet/.midnight-indexer.env.example infra/localnet/.midnight-indexer.env
# Fill all four values privately, then verify the file mode before Compose reads it.
test "$(stat -f %Lp infra/localnet/.midnight-indexer.env)" = 600
docker compose -p midnight-network -f infra/localnet/docker-compose.ledger9.yml config --quiet
docker compose -p midnight-network -f infra/localnet/docker-compose.ledger9.yml up -d
# Owner shutdown, preserving volumes:
docker compose -p midnight-network -f infra/localnet/docker-compose.ledger9.yml down
```

After startup, the owner runs a representative proof, submission and indexed
confirmation before offering the stack to consumers. Do not remove its volumes
for routine shutdown or version changes.

## Isolated prover for the pinned Compact 0.35 ACC

If the owner's current proof server rejects an ACC proof from the pinned
Compact 0.35 artifact, preserve the failed account and transaction records.
The optional [`docker-compose.compat-prover.yml`](docker-compose.compat-prover.yml)
starts only a digest-pinned `9.0.0-rc.8` proof server on loopback port `16301`.
It does not start or change the shared node, indexer, or prover. Use a unique
project name and check the version before continuing the **same** pending ACC:

```sh
export PASSPORT_COMPAT_PROVER_PROJECT=midnight-passport-compat-prover-my-run
docker compose -p "$PASSPORT_COMPAT_PROVER_PROJECT" \
  -f infra/localnet/docker-compose.compat-prover.yml up -d proof-server
PASSPORT_COMPAT_PROVER=1 MIDNIGHT_STACK=shared-ledger9 \
  PASSPORT_REGISTRY_FILE=/absolute/private/registry.json \
  nix develop -c pnpm demo check --no-key-service
```

Pass `PASSPORT_COMPAT_PROVER=1` to the matching demo run. The launcher requires
the isolated server's exact version and pins both the service and browser
public proving URLs to it; a conflicting public URL is refused. It still verifies the owner's stack at
its original endpoints. A successful proof and indexed account activation are
required before registry bootstrap; the version check alone proves neither.
The pinned ACC was compiled with Compact 0.35 and Compact.js 3.0.0-rc.3.
On the current shared Ledger 9.1.0.1 node, a recovered activation proof can
succeed on this compatibility prover but the node can still reject its
transaction with `Custom error: 104` (`ran out of gas budget`).
In a bounded retry, pinning the released `@midnightntwrk/ledger-v9` 1.0.0
client and resuming the **same** pending ACC produced indexed activation on
this chain. This observation does not isolate the cause of the earlier rejection
or qualify other environments.
[Compact.js 3.0.0](https://docs.midnight.network/relnotes/compact-js/compact-js-3-0-0)
fixes gas-budget checks for calls that overwrite ledger state, but requires
Compact 0.36 artifacts. This is a compatibility lead, not a diagnosis of
this rejected transaction. Replacing the runtime for an already deployed ACC
without a verified maintenance migration is not a safe repair. Keep that
ACC's address, passkey, original deployment records and failed submission
diagnostics. Confirm `booted=true` from the v4 indexer before using it as a
Midnames root. If activation is rejected, investigate the versioned artifact
and maintenance path before retrying or deploying a replacement account.
When the demo has drained and released its sponsor lease, stop only this
isolated prover with the same Compose project and file. It has no volumes.

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
