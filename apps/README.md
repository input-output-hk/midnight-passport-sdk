# Passport prototype: apps

A prototype of the Midnight Passport DApp Connector API and the web app that carries its heavy
lifting. Design: [`docs/superpowers/specs/2026-10-06-passport-dapp-design.md`](../docs/superpowers/specs/2026-10-06-passport-dapp-design.md).

| App                | What                                                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `passport-service` | Serves the ACC's ZK artefacts (`/zk/acc`), proves with server-side keys (`/prove`), deploys in waves (`/deploy`), sponsors fees (`/sponsor/*`) and keeps the passkey-to-account registry (`/accounts`). It holds the only funded key. Binds `127.0.0.1:8787`. |
| `passport-dapp`    | The harness at `http://localhost:5173`: create a Passport account with a passkey, open it after a reload, rotate its encryption key (a passkey-signed, server-proved call) and connect the built-in wallet.                                           |

## Prerequisites

- **Nix.** Everything runs in the repository's Nix shell (`nix develop`), so no other Compact or
  Midnight stack version on the machine is used. Each script starts with
  [`guard.sh`](../experiments/acc-0.35/guard.sh), which refuses to run outside it.
- **Docker with at least 24 GiB of memory** (Docker Desktop, Settings, Resources). P-256 proofs are
  k = 18 and need about 13.5 GiB each. Set `ACC_MIN_DOCKER_GIB` to change the check.
- **The ACC artefacts**, fetched and compiled with every key (about 12 GB, tens of minutes), as in
  [`experiments/acc-0.35/README.md`](../experiments/acc-0.35/README.md):

```sh
nix develop
export PASSPORT_REPO=/path/to/your/passport/checkout
D=$(experiments/acc-0.35/fetch-acc.sh 45721e1 | tail -1)
experiments/acc-0.35/compile.sh "$D" full && (cd "$D" && npm ci --ignore-scripts)
export PASSPORT_CONTRACT_DIR="$D"
export PASSPORT_MANIFEST_SHA256=$(shasum -a 256 "$D/contracts/managed/account/compiler/contract-manifest.json" | cut -d' ' -f1)
pnpm install && pnpm build
```

## Environment

| Variable                   | Default                        | Meaning                                                                                                                  |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `PASSPORT_CONTRACT_DIR`    | required                       | The `fetch-acc.sh` output, the directory holding `contracts/managed`.                                                    |
| `PASSPORT_MANIFEST_SHA256` | required                       | SHA-256 of `compiler/contract-manifest.json`, 64 hex characters (see the manifest pin).                                  |
| `MIDNIGHT_NETWORK`         | `local` (set by `prototype:up`) | Selects the localnet endpoints in the reference wave-deploy code the service reuses.                                    |
| `PASSPORT_NETWORK_ID`      | `undeployed`                   | The network id the registry, the PRF salt and the connector's check use.                                                 |
| `PASSPORT_SERVICE_HOST`    | `127.0.0.1`                    | Service bind address. A non-loopback host exposes the sponsor to whoever can reach it.                                   |
| `PASSPORT_SERVICE_PORT`    | `8787`                         | Service port. The dapp expects 8787 unless `VITE_PASSPORT_SERVICE_URL` says otherwise.                                   |
| `PASSPORT_MAX_DEPLOYS`     | `20`                           | Deploy cap per service process.                                                                                          |
| `PASSPORT_REGISTRY_FILE`   | `<contract dir>/../passport-registry.json` | The registry; the deployed set sits beside it as `*.deployments.json`. Delete both when you reset the chain.                         |
| `PASSPORT_SPONSOR_SEED`    | the localnet genesis dev seed  | The sponsor wallet's seed. The default is public knowledge and funded on the localnet only.                              |

## Running

```sh
pnpm prototype:up        # localnet, then service, then dapp; Ctrl-C stops the service and the localnet
pnpm prototype:service   # the service alone (localnet already up)
pnpm prototype:dapp      # the dapp alone, at http://localhost:5173
pnpm prototype:e2e       # in another shell: the automated MVP run with a software passkey
```

`prototype:up` checks, in order: the Nix toolchain, the two required variables (and that the hash
matches the manifest on disk), Docker memory, and that ports 9944, 8088, 6300, 8787 and 5173 are
free. If one is taken it names the occupant (container or process) and exits; it never stops
anything for you. `bash scripts/prototype-up.sh --check` runs only the port check. It then starts
the node and proof server, waits for block 2 (the indexer's SPO client fails on a chain still at
genesis), starts the indexer, then the service, then the dapp. On exit it stops only the containers
it started and leaves their volumes, so a rerun resumes the same chain. To reset the chain, run
`experiments/acc-0.35/run.sh "$D" down` and delete the registry file and its `.deployments.json`.

Open `http://localhost:5173` in a browser with a platform passkey. `prototype:e2e` writes its
evidence to `experiments/acc-0.35/results/x8-dapp-e2e.json`.

## What to know

- **Create asks for the passkey twice.** Once to create the credential, and once more for an
  enrolment probe: a throwaway assertion that proves the authenticator produces the exact WebAuthn
  material the ACC verifies, before anything is deployed.
- **Encryption keys are throwaway.** The harness draws a random 32-byte encryption key at create
  and at each rotation and keeps no copy. Nothing encrypted to it can be recovered. Real key
  management is out of scope.
- **The service binds loopback** (`127.0.0.1`) and its CORS allows only the dapp origin.
- **Sponsor policy** (spec section 4.3):
  - _Calls only._ `/sponsor/balance` balances only a standard transaction whose every contract
    action is a call.
  - _Deployed accounts only._ Each call must target a Passport account this service deployed and
    that is registered on its network. Deploy and maintenance actions are refused.
  - _Fee-only._ No unshielded offer, no Dust action and no shielded offer, and no non-Dust
    imbalance in any segment.
  - _Deploy cap._ At most `PASSPORT_MAX_DEPLOYS` `/deploy` requests per service process, failures
    counted, then `429`. The count resets on restart.
- **Manifest pin (R18).** The dapp bakes `PASSPORT_MANIFEST_SHA256` in when Vite starts and checks
  the service's `/config` against it, refusing a mismatch (`ArtefactIntegrity`). It is never read
  from the service, which could otherwise vouch for its own tampered artefacts. The service
  verifies the same hash and every listed file at start-up. Changing the artefacts means
  restarting both.
- **Built-in wallet.** An in-page wallet seeded from the passkey's PRF output at a network-bound
  salt, exposed as `window.midnight.devwallet`. If the authenticator has no PRF, it falls back to
  the public genesis dev seed on `undeployed` only, and refuses on any other network. Anyone can
  derive that wallet. The ACC flows do not depend on it: fees are sponsored.

## Production requirements (not built)

Authenticated sessions (a signed-in passkey or a dApp credential) on `/prove`, `/sponsor/*` and
`/deploy`; per-client rate limits; spending caps per client and per day on the sponsor; proof of
possession on `PUT /accounts`; a per-job timeout on the proof queue; durable deploy counters (the
cap resets on restart); and TLS in front of the service.

## Troubleshooting

- **A port is taken.** The preflight names the container or process. The usual cause is another
  localnet (ports 9944, 8088 and 6300) or a stale run: stop it yourself with `docker stop <name>`
  or by quitting the process, then retry.
- **`localhost` or `127.0.0.1`.** Open the dapp at exactly `http://localhost:5173`: the passkey's
  relying party and the ACC's origin binding are tied to that origin, and `127.0.0.1` will not
  work. The service listens on `127.0.0.1` only. If the browser or Node resolves `localhost` to
  `::1` first and fetches to `http://localhost:8787` are refused, start the dapp with
  `VITE_PASSPORT_SERVICE_URL=http://127.0.0.1:8787`.
- **`guard:` errors.** You are outside the Nix shell. Run `nix develop`.
- **Docker has too little memory.** Raise it to at least 24 GiB and retry. `/prove` otherwise
  reports `ProverUnavailable`.
- **Manifest hash does not match.** Recompute `PASSPORT_MANIFEST_SHA256` from the artefacts you
  compiled. It is only reproducible from the canonical `compile.sh` invocation.
- **The service exits at start-up.** Its first line says why: usually missing artefacts or a
  hash mismatch.
- **Stale registry after a chain reset.** Delete `passport-registry.json` and `passport-registry.deployments.json` when you drop the volumes, or the registry will name accounts the chain no longer has and opening them fails.
