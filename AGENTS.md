# AGENTS.md: run the Passport DApp prototype

This guide is for people and coding agents who check out the `passport-acc-prototype` branch and
want to run the Midnight Passport DApp demo themselves. Everything runs inside the repository's Nix
shell.

**What the demo does:**

- A person creates a Midnight Passport account with only a passkey: no tokens, no recovery phrase.
- The service deploys the account contract (ACC), proves every transaction, and pays the fees.
- The page then makes a passkey-signed transaction and reopens the account after a reload.
- A read-only wallet, seeded from the same passkey, stands behind the DApp Connector API.

**Background reading:**

- [`docs/prototype/`](docs/prototype/README.md): the overview, the demo script, the flows, the keys,
  the limits, and the architecture compared with the SDK proposal.
- [`apps/README.md`](apps/README.md): every environment variable and script.

## 1. What you need

| Requirement                                                                                                     | Why                                                                                                         |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| macOS or Linux with [Nix](https://nixos.org/download) (flakes enabled)                                          | The shell pins Node, pnpm and Compact 0.35.0. A global `compact` is refused.                                |
| Docker with **at least 24 GiB memory** (Docker Desktop: Settings → Resources → Memory)                          | A P-256 proof needs about 13.5 GiB on the proof server.                                                     |
| About 15 GB free disk, and about 8 GB RAM for key generation                                                    | The 52-circuit ACC has 12 GB of prover keys.                                                                |
| A local checkout of the Passport planning workspace (the passport contract repository; ask the team for access) | The contract source is exported from revision `45721e1`.                                                    |
| Chrome or Safari, with a passkey saved in **Google Password Manager or iCloud Keychain**                        | The account needs the WebAuthn PRF extension. Chrome's "Chrome profile" store has no PRF and is refused.    |
| Free ports 19944, 18088, 16300, 8787 and 5173                                                                   | The Passport localnet uses its own host ports, so it runs beside another Midnight localnet on the defaults. |

## 2. One-time setup

```sh
git clone https://github.com/input-output-hk/midnight-passport-sdk.git
cd midnight-passport-sdk
git switch passport-acc-prototype
nix develop                          # or: direnv allow

export PASSPORT_REPO=/path/to/your/passport/checkout
git -C "$PASSPORT_REPO" fetch        # make sure revision 45721e1 is present

# Export the contract tree into experiments/acc-0.35/work/ (git-ignored). This also patches the
# exported reference client so it reads the Passport localnet's ports.
D=$(experiments/acc-0.35/fetch-acc.sh 45721e1 | tail -1)

# Compile the contract with every prover and verifier key: about 22 minutes, 12 GB, on the host.
experiments/acc-0.35/compile.sh "$D" full

export PASSPORT_CONTRACT_DIR="$D"
export PASSPORT_MANIFEST_SHA256=682bfbd3420e4ad1ce8061a585f1029c395d82accdee030751ed25ede62df8ec
```

Check that your build matches the pinned hash. The build is byte-reproducible across machines, but
only through `compile.sh`'s canonical invocation:

```sh
shasum -a 256 "$D/contracts/managed/account/compiler/contract-manifest.json"
# expect 682bfbd3420e4ad1ce8061a585f1029c395d82accdee030751ed25ede62df8ec
```

Put the two `export`s in your shell profile, or in `.envrc.local` if you use direnv, so later shells
have them.

## 3. Run the demo

```sh
nix develop -c pnpm prototype:up
```

`prototype:up` runs these steps in order:

1. Checks the toolchain, the contract directory and the manifest hash.
2. Installs the contract tree's dependencies, the first time only.
3. Builds the workspace.
4. Checks Docker memory and that the ports are free. It names whatever holds a port, and never stops it for you.
5. Starts the node and the proof server, then the indexer once the chain reaches block 2.
6. Starts the service on `127.0.0.1:8787`.
7. Starts the page on `http://localhost:5173`.

Ctrl-C stops all of it and keeps the chain's data.

Open **exactly** `http://localhost:5173/`. Use `localhost`, not `127.0.0.1`: the passkey and the
contract's WebAuthn profile are bound to that origin.

| Step                                                     | Passkey prompts                                          | Takes                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Create account**                                       | 2, or 3 if your provider returns PRF only after creation | about 4 min: 10 deploy waves (about 180 s), then activation (about 25 s) |
| **Rotate encryption key** (a passkey-signed transaction) | 1                                                        | about 1 min                                                              |
| Reload the page, then **Open with passkey**              | 1                                                        | under a second                                                           |
| **Connect built-in wallet**                              | 1 with an account open, otherwise 2                      | seconds                                                                  |
| **Copy evidence**                                        | none                                                     | copies the event log as JSON, with no secrets                            |

The page shows a progress bar and an event log with each step's start, end, duration and any error.

**Without a real authenticator:** open `http://localhost:5173/?mockPasskey`. This dev-only mock
keeps its keys in `localStorage`, so it is only for testing. `?mockPasskey=noprf-results` exercises
the 3-prompt path.

## 4. Run the automated end-to-end test

With `prototype:up` running, open a second shell with the same two variables set:

```sh
nix develop -c pnpm prototype:e2e
```

It drives the real connector with a software passkey through these steps: create, rotate, reopen,
rotate again. It writes `experiments/acc-0.35/results/x8-dapp-e2e.json` and should end with
`MVP e2e: PASS` after about 5½ minutes.

## 5. Where state lives, and how to reset it

| State                                                            | Where                                                                | Reset                                                                                                    |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| The chain (accounts, contracts)                                  | Docker volumes of the `mn-passport-sdk-localnet` compose project     | `docker compose -f infra/localnet/docker-compose.yml -f infra/localnet/docker-compose.macos.yml down -v` |
| Passkey-to-account lookup, and the accounts the sponsor pays for | `~/.midnight-passport/registry.json` and `registry.deployments.json` | Delete both **whenever you reset the chain**, or Open fails with `AccountNotFound`                       |
| Your passkey                                                     | Your password manager                                                | Delete old `localhost` passkeys so the picker offers only the current one                                |
| Mock passkey                                                     | The page's `localStorage` (`passport-dev:mock-passkey:v1`)           | Clear site data for `localhost:5173`                                                                     |

## 6. Troubleshooting

| You see                                                          | Do this                                                                                                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `guard: …`                                                       | You are outside the Nix shell. Run `nix develop`.                                                                                                                  |
| `prototype-up: port … is taken by …`                             | Another process or localnet holds a Passport port. Stop it yourself, or move the Passport stack in `infra/localnet/ports.env` and `infra/networks/undeployed.env`. |
| `Docker has N GiB; P-256 proofs need at least 24`                | Raise Docker's memory, restart Docker, then retry.                                                                                                                 |
| `PASSPORT_MANIFEST_SHA256 does not match`                        | The contract wasn't built with `compile.sh … full` from the `45721e1` export, or the build is incomplete. Rebuild.                                                 |
| `UnsupportedAuthenticator: … does not support the PRF extension` | Create the passkey in Google Password Manager or iCloud Keychain, not the Chrome profile store. Nothing was deployed.                                              |
| `The authenticator does not match the wa-json134 profile`        | Your browser produced WebAuthn data the contract's fixed format rejects. Nothing was deployed. Retry, or try another browser.                                      |
| `This is not the passkey this account was created with`          | Pick the passkey you created the account with.                                                                                                                     |
| `AccountNotFound` after a chain reset                            | Delete `~/.midnight-passport/registry*.json`.                                                                                                                      |
| `ProverUnavailable` after about 10 minutes                       | A transaction queued behind a deploy timed out. Wait for the deploy to finish, then retry.                                                                         |

## 7. Rules for coding agents working on this branch

- **Use Nix for every command:** `nix develop -c …`. Never call a global `compact`, `node` or
  `pnpm`. The scripts' `guard.sh` refuses any toolchain outside the Nix store.
- **Run the checks locally before every commit.** CI is suspended while prototyping (its PR trigger
  is commented out in `.github/workflows/pr-checks.yml`).

  ```sh
  nix develop -c bash -c 'pnpm run lint && pnpm run format:check && pnpm run build && pnpm test \
    && pnpm run test:apps && pnpm --filter passport-service exec tsc --noEmit -p . \
    && pnpm --filter passport-dapp exec tsc --noEmit -p .'
  ```

- **Commits.** Use conventional commits, made with `git commit -S -s` (GPG signature plus DCO
  sign-off), and end the message with an `Assisted-by: AI` trailer. Never add a `Co-Authored-By`
  trailer that names a model. Check `git log --format='%h %G?' -1` shows `G` after each commit.
- **Fork only.** Push branches and open pull requests only in `input-output-hk/midnight-passport-sdk`,
  against `passport-acc-prototype`. Never push, open issues or comment anywhere upstream.
- **Leave other people's processes alone.**
  - Don't stop other Docker stacks or localnets. The Passport stack has its own ports.
  - Stop a process you started by its PID. Never use `pkill` patterns.
- **Never commit secrets.** No real network stack file (`infra/networks/*.env` other than
  `undeployed.env` is git-ignored), no sponsor seed, no passkey or PRF material, and no prover keys.
- **Keep the docs in step.** When a flow, an endpoint or a prompt count changes, update
  `docs/prototype/` and `apps/README.md` in the same pull request.

### Where things are

| Path                               | What                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/protocol`                | Connector API types, error codes                                                                                                           |
| `packages/account`                 | Connector flows (create, open, signed calls) behind injected seams; platform-neutral                                                       |
| `packages/adapter-browser`         | WebAuthn passkey and PRF, the Lace key recipe, the midnight-js chain over the service, the `window.midnight.passport` shim                 |
| `apps/passport-service`            | Artefact host (`/zk`), transaction prover (`/prove-tx`), fee sponsor (`/sponsor/*`), wave deploy (`/deploy`), account lookup (`/accounts`) |
| `apps/passport-dapp`               | The demo page, the built-in wallet, the mock passkey, the e2e scripts                                                                      |
| `infra/localnet`, `infra/networks` | The Passport localnet and the Midnight stack configuration (one file per network)                                                          |
| `experiments/acc-0.35`             | Fetch, compile and run scripts for the contract, plus run records `results/x1–x9`                                                          |
| `docs/superpowers/specs/`          | The prototype spec and the publishing design for the SDK packages                                                                          |
