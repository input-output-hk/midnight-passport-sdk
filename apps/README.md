# Passport prototype: apps

A prototype of the Midnight Passport DApp Connector API and the web app that carries its heavy
lifting. Design: [`docs/superpowers/specs/2026-10-06-passport-dapp-design.md`](../docs/superpowers/specs/2026-10-06-passport-dapp-design.md).

| App                | What                                                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `passport-service` | Serves the ACC's ZK artefacts (`/zk/acc`), proves with server-side keys (`/prove`), deploys in waves (`/deploy`), sponsors fees (`/sponsor/*`) and keeps the passkey-to-account registry (`/accounts`). It holds the only funded key. Binds `127.0.0.1:8787`. |
| `passport-dapp`    | The harness at `http://localhost:5173`: create a Passport account with a passkey, open it after a reload, rotate its encryption key (a passkey-signed, server-proved call) and connect the built-in wallet.                                           |

## Documentation

The prototype's overview, the demo script, the flows, the key derivation and the limitations are in
[`docs/prototype/`](../docs/prototype/README.md). This file covers setup and operation.

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
| `PASSPORT_NETWORK_ID`      | `undeployed`                   | Fixed: the reference client hard-codes the localnet, so any other value refuses to start. The same holds for `PASSPORT_INDEXER_URI`, `PASSPORT_INDEXER_WS_URI`, `PASSPORT_NODE_URI` and `PASSPORT_PROOF_SERVER_URI`. |
| `PASSPORT_SERVICE_HOST`    | `127.0.0.1`                    | Service bind address. A non-loopback host exposes the sponsor to whoever can reach it.                                   |
| `PASSPORT_SERVICE_PORT`    | `8787`                         | Service port. The dapp expects 8787 unless `VITE_PASSPORT_SERVICE_URL` says otherwise.                                   |
| `PASSPORT_MAX_DEPLOYS`     | `20`                           | Deploy cap per service process.                                                                                          |
| `PASSPORT_REGISTRY_FILE`   | `~/.midnight-passport/registry.json` | The passkey-to-account registry; the deployed set sits beside it as `registry.deployments.json`. Kept outside the repository so accounts can be reopened later. Delete both when you reset the chain. |
| `PASSPORT_SPONSOR_SEED`    | the localnet genesis dev seed  | The sponsor wallet's seed. The default is public knowledge and funded on the localnet only.                              |

## Running

```sh
pnpm prototype:up        # localnet, then service, then dapp; Ctrl-C stops the service and the localnet
pnpm prototype:service   # the service alone (localnet already up)
pnpm prototype:dapp      # the dapp alone, at http://localhost:5173
pnpm prototype:e2e       # in another shell: the automated MVP run with a software passkey
```

`prototype:up` checks, in order: the Nix toolchain, the two required variables (and that the hash
matches the manifest on disk), Docker memory, and that ports 19944, 18088, 16300, 8787 and 5173 are
free. If one is taken it names the occupant (container or process) and exits; it never stops
anything for you. `bash scripts/prototype-up.sh --check` runs only the port check. It then starts
the node and proof server, waits for block 2 (the indexer's SPO client fails on a chain still at
genesis), starts the indexer, then the service, then the dapp. On exit it stops only the containers
it started and leaves their volumes, so a rerun resumes the same chain. To reset the chain, run
`experiments/acc-0.35/run.sh "$D" down` and delete the registry file and its `.deployments.json`.

Open `http://localhost:5173` in a browser with a platform passkey. `prototype:e2e` writes its
evidence to `experiments/acc-0.35/results/x8-dapp-e2e.json`.

**No authenticator?** Under `pnpm prototype:dapp` (Vite dev only), open
`http://localhost:5173/?mockPasskey`. A dev-only mock (`src/dev/mock-passkey.ts`) replaces
`navigator.credentials` before the app loads, so the real UI path runs end to end: a WebCrypto
P-256 key, `wa-json134` assertions (37-byte authenticator data, flags UP+UV) and PRF as
HMAC-SHA256 under a random per-credential secret. As Google Password Manager is expected to, it answers
both PRF salts already at create, so create asks twice; `?mockPasskey=noprf-results` answers only
`prf.enabled` at create, so the third prompt (the separate PRF ceremony) can be clicked through.
Its credentials, private keys and PRF secrets
included, are kept in `localStorage` (`passport-dev:mock-passkey:v1`) so that "Open with passkey"
works after a reload; a discoverable prompt picks the newest one. The page shows a "MOCK PASSKEY —
dev only" banner and the evidence records `"passkey": "MOCK …"`. Production builds do not contain
the mock. `pnpm --filter passport-dapp test` checks it against `browserPasskey`'s enrolment probe
and `assertionMaterial`.

## What to know

- **Save the passkey in a PRF-capable provider: Google Password Manager or iCloud Keychain.**
  The account and the built-in wallet need the WebAuthn PRF extension. When Chrome asks where to
  save the passkey, do not pick the "Chrome profile" store: it has no PRF, and neither do some
  security keys. Create asks for PRF and refuses, right after the first prompt and before
  anything is deployed, any provider that does not confirm it (`UnsupportedAuthenticator`, "choose
  a PRF-capable provider").
- **How many times the passkey is asked for.** Every prompt after create or open is pinned to the
  account's own passkey (`allowCredentials`), so the browser offers no other passkey for
  `localhost`; if another one answers, the error says "This is not the passkey this account was
  created with; choose that passkey". Only "Open with passkey", and the wallet with no account
  open, show the passkey picker.

  | Action                                                                                                         | Prompts | Which                                                                         |
  | -------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------- |
  | Create, provider returns PRF results at create (the mock; Google Password Manager expected, not yet confirmed) | 2       | create; enrolment probe (the encryption key uses the create-time PRF outputs) |
  | Create, provider returns only `prf.enabled` (`?mockPasskey=noprf-results`)                                     | 3       | create; enrolment probe; PRF ceremony for the encryption key                  |
  | Create, provider without PRF                                                                                   | 1       | create, then refused; nothing is deployed                                     |
  | Open with passkey                                                                                              | 1       | the passkey picker (discoverable)                                             |
  | Rotate the encryption key                                                                                      | 1       | a signature, pinned to the account's passkey                                  |
  | Built-in wallet, account open                                                                                  | 1       | the PRF ceremony, pinned to the account's passkey                             |
  | Built-in wallet, no account open                                                                               | 2       | the passkey picker; then the PRF ceremony, pinned to the passkey picked       |

  The enrolment probe is a throwaway assertion that proves the authenticator produces the exact
  WebAuthn material the ACC verifies. PRF output adds extension data that this material forbids,
  so PRF can never share the probe or a signature. PRF outputs returned at create are held in
  memory only, used once for the encryption key, then zeroed (60 s at most if unused); they are
  never stored, logged or written into the evidence.
- **No PRF at a later prompt.** If the wallet's PRF ceremony gets no output, the error says the
  passkey has no PRF, or is a different passkey from the account's: choose the account's own
  passkey, saved in Google Password Manager or iCloud Keychain.
- **Reopening checks the registry.** The registry is only a hint. `openAccount` uses a record only
  when the passkey you picked owns the record's key, a contract exists at its address, and that
  contract holds the passkey as a device. Anything else is `AccountNotFound`, which after a chain
  reset usually means a stale registry (see Troubleshooting).
- **Keys follow the Lace recipe v1** (lace-platform main, LW-15585 / LW-15584 / LW-15635;
  `packages/adapter-browser/src/lace-recipe.ts`). One PRF ceremony evaluates
  `SHA-256('lace-passport/prf/authoriser/v1')` and `SHA-256('lace/prf/root/v1')`. The root
  (output #2) gives the wallet entropy (HKDF, info `lace/hkdf/wallet-entropy/v1`), 24 BIP-39
  words (HKDF, salt `lace`, info `wallet-seed`) and the 64-byte BIP-39 seed. The account's
  `enc_key` is the X25519 public key of MIP-0015 v1 `deriveSymmetricSecret(seed,
  'lace-passport:acc-enc:v1', '<networkId>/0')`: bound to the network and reproducible from the
  passkey. The tests reproduce Lace's own vectors.
  - _Rotation keys are random._ Lace has no rotation recipe yet, so `rotateEncryptionKey` takes
    a random key and keeps no copy: a prototype extension.
  - _Divergence from Lace._ Lace's ACC authoriser is a JubJub key from PRF output #1. This
    prototype uses the ACC's P-256 WebAuthn arm, where the passkey signs each call, so output #1
    is evaluated but unused.
- **The service binds loopback** (`127.0.0.1`). CORS lets only the dapp origin read its answers,
  which on its own does not stop a cross-site page from sending a request. So the service also
  answers `415` to any POST or PUT whose `content-type` is not `application/json` (that forces a
  CORS preflight, which only the dapp origin passes) and `421` to any `Host` other than
  `127.0.0.1`, `localhost` or `[::1]` at its port, or `PASSPORT_SERVICE_HOST` when set (DNS
  rebinding).
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
- **Built-in wallet.** An in-page wallet built with `HDWallet.fromSeed` from the passkey's
  BIP-39 seed (above), exposed as `window.midnight.devwallet`. Lace has no phrase-derived
  Midnight wallet in scope; this is the prototype's stand-in. Without PRF it fails with
  `UnsupportedAuthenticator`: there is no fallback seed, so it never opens a different, empty
  wallet, and the web app never carries the genesis (sponsor) seed. The ACC flows do not depend
  on the wallet: fees are sponsored.

## Production requirements (not built)

Authenticated sessions (a signed-in passkey or a dApp credential) on `/prove`, `/sponsor/*` and
`/deploy`; per-client rate limits; spending caps per client and per day on the sponsor; proof of
possession on `PUT /accounts`; a per-job timeout on the proof queue; durable deploy counters (the
cap resets on restart); TLS in front of the service; and the indexer and node endpoints pinned at
build time, like the manifest. Today the browser takes them from the service's `/config`, so a
compromised service could fake the ledger that `openAccount`'s checks read.

## Troubleshooting

- **A port is taken.** The preflight names the container or process. The Passport localnet
  publishes the node, indexer and proof server on host ports 19944, 18088 and 16300
  (`infra/localnet/ports.env`), so it runs beside another localnet on the Midnight defaults
  (9944/8088/6300). A clash usually means a stale run: stop it yourself, then retry. To move the
  stack, edit `ports.env`; the patched reference client and the service read the same variables.
- **`localhost` or `127.0.0.1`.** Open the dapp at exactly `http://localhost:5173`: the passkey's
  relying party and the ACC's origin binding are tied to that origin, and `127.0.0.1` will not
  work. The service listens on `127.0.0.1` only. If the browser or Node resolves `localhost` to
  `::1` first and fetches to `http://localhost:8787` are refused, start the dapp with
  `VITE_PASSPORT_SERVICE_URL=http://127.0.0.1:8787`.
- **`guard:` errors.** You are outside the Nix shell. Run `nix develop`.
- **`two compact-runtime copies are loaded`.** The generated contract module was imported from
  `PASSPORT_CONTRACT_DIR`, where its `compact-runtime` import resolves the contract tree's own copy
  (onchain-runtime rc.3) instead of the workspace's (rc.4). `dev`, `build`, `test` and `e2e` first
  run `scripts/sync-acc.mjs`, which copies `index.js`, `index.d.ts` and the source map into
  `apps/passport-dapp/src/acc/generated/` (git-ignored); the dapp and the e2e import it as `#acc`
  (package.json `imports`), so it resolves the runtime midnight-js uses. Rerun
  `pnpm --filter passport-dapp sync:acc` after recompiling the ACC.
  `PASSPORT_CONTRACT_DIR=<dir> pnpm --filter passport-dapp test` checks this offline in seconds.
- **`ProverUnavailable` after about 10 minutes.** The dapp gives up on `/prove` after 10 minutes,
  but proofs and deployments share one queue on the service. A rotation queued behind a `/deploy`
  (10 waves) can time out while the service keeps proving it. Wait for the deployment to finish,
  then retry.
- **Indexer requests fail in the browser.** The page queries the localnet indexer at
  `http://localhost:18088` from `http://localhost:5173`. Whether the indexer sends CORS headers has
  not been checked yet; look for a CORS error in the browser console before suspecting the
  connector.
- **Docker has too little memory.** Raise it to at least 24 GiB and retry. `/prove` otherwise
  reports `ProverUnavailable`.
- **Manifest hash does not match.** Recompute `PASSPORT_MANIFEST_SHA256` from the artefacts you
  compiled. It is only reproducible from the canonical `compile.sh` invocation.
- **The service exits at start-up.** Its first line says why: usually missing artefacts or a
  hash mismatch.
- **Stale registry after a chain reset.** The registry is only valid for the chain it was written on. `prototype:up` stops the localnet with its volumes kept, so accounts survive a restart. If you drop the volumes (`docker compose … down -v`, or `experiments/acc-0.35/run.sh`, which starts fresh), delete `~/.midnight-passport/registry.json` and `registry.deployments.json`, or opening fails with `AccountNotFound`.
