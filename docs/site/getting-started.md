---
layout: default
title: Install and connect
permalink: /getting-started/
---

Use this path to evaluate the implemented libraries in a wallet host or browser application.
To try the full reference UI first, use the [demo use cases]({{ '/use-cases/' | relative_url }})
and [agent/local setup guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/AGENTS.md).
The upstream app engine and dApp grant protocol are broader than this preview; the account-owner
API is the implemented integration surface.

## 1. Choose the integration boundary

| You are building | Start with | You provide |
| --- | --- | --- |
| Browser host using local WebAuthn | `adapter-browser`, `adapter-service`, `contract`; `account/ports` for host types | Network and binding pins, persistent account records, a PRF-capable passkey provider and backend URLs. |
| Wallet host with its own signer and transaction handles | `account`, `protocol`, `contract`, then the adapters you need | Implementations of the typed account ports, consent, persistence, proof/value routing and settlement. See the [Lace guide]({{ '/lace-handover/' | relative_url }}). |
| Proving/key infrastructure | The three service images, or `service` for an embedded Node host | Verified key cache, network endpoints, controlled ingress, and appropriate wallet/state configuration. |
| Backend caller funding an ACC | `adapter-service/faucet` | Authenticated backend access, an eligible deployed ACC and a persistent request ID. Never put the funding token in browser code. |

Install the packages you import, not every package in the repository. Their dependencies bring
in supporting implementations. The [package map]({{ '/packages/' | relative_url }}) explains all
nine released libraries and the excluded scaffolds. The ACC is a smart contract; the optional
built-in HD wallet is a separate account with a separate balance.

## 2. Authenticate and install an exact version

The packages are **private GitHub Packages**, not npmjs packages. Ask a package administrator
for read access. A developer token needs package read permission; a consuming Actions repository
must be granted package access for its `GITHUB_TOKEN`.

Set the token outside source control and use a user-level credential file (for npm, `~/.npmrc`). The pinned pnpm
refuses environment interpolation in project-level auth settings, even in a
git-ignored project file; keep credentials in user configuration:

```ini
@input-output-hk:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Install the verified RC5 preview:

```sh
npm install --save-exact \
  @input-output-hk/mn-passport-account@0.1.0-rc5 \
  @input-output-hk/mn-passport-adapter-browser@0.1.0-rc5 \
  @input-output-hk/mn-passport-adapter-service@0.1.0-rc5 \
  @input-output-hk/mn-passport-contract@0.1.0-rc5
```

Node tooling requires Node 22 or newer. The repository uses `nix develop` to pin Node, pnpm and
Compact. Keep all SDK packages on the same exact release. `next` is a moving preview tag;
pin a version and lockfile for a reproducible integration.

## 3. Start and verify the backend

For local evaluation use `nix develop -c pnpm demo up` with the pinned ACC export, as described
in the setup guide. Packages alone do not start a chain, create keys or fund a fee wallet.

| Service | Default local endpoint | Purpose |
| --- | --- | --- |
| Passport service | `http://127.0.0.1:8787` | Checked config, binding artefacts, deployment, proof jobs, directory and fee sponsorship. |
| Key service | `http://127.0.0.1:8788` | Restore and verify prover keys, then serve pinned files over HTTP. Optional when using the Passport service's local artefacts. |
| Funding service | `http://127.0.0.1:8789` | Authenticated, allowlisted wallet-to-ACC deposits; started by `--funding`. It is not a fee sponsor. |

Check `/healthz` and `/v1/config` on the Passport service. The network must be `undeployed`,
binding `acc-s3r1.1`, compiler manifest SHA-256
`77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f`.
Derive this pin from the installed contract package or trusted release evidence, not from the
server's answer. The example below uses `resolveBinding` and `fetchCheckedV1Config` to do that.

Production hosts need explicit public URLs, authenticated ingress, fee/funding limits and durable
state. A standalone network's public genesis wallet is for `undeployed` only. Linux images need
Linux-prepared contract dependencies; mounting a macOS `node_modules` is not supported.

## 4. Compose the browser account API

The maintained [browser composition example](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc5/docs/examples/browser-quickstart.ts)
creates a sealed P-256 account API using the checked local service and packaged binding. Its
`connectLocalPassport(records)` argument is a host-owned `AccountRecordStore`, not a seed store.
Implement its `read`, `write` and `exists` methods persistently before creating an account. Preserve
`localUseCounter` as a bigint and `credentialId` as bytes when serialising. The reference demo's
[record store](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc5/apps/passport-dapp/src/grant-journal.ts)
shows validation and encoding. Store keys must distinguish network, binding and device/account;
the demo keeps one selected record per network for evaluation.

Call the API from explicit user actions:

```ts
const passport = await connectLocalPassport(records);

// In the Create button handler; do not create an account on every page load.
const account = await passport.createAccount({
  userName: 'alice',
  retireAuthority: true,
  onEvent: (event) => showProgress(event),
});
console.log(account.address, await account.state());

// In a later Open button handler, using the same persistent host store and passkey:
const reopened = await passport.openAccount();
console.log(reopened.address);
```

Here `records` and `showProgress` are application-owned persistence and presentation; they are
not additional SDK globals. `retireAuthority: true` retires the deployment maintenance authority,
so the deployed ACC cannot later be upgraded through it. Make that choice explicitly.

Run at exactly `http://localhost:5173` for this local example. The passkey RP ID, origin and
contract WebAuthn profile must agree. The reference [Vite configuration](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc5/apps/passport-dapp/vite.config.ts)
and [polyfill entrypoint](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc5/apps/passport-dapp/src/polyfills.ts)
show the Buffer initialisation, WASM support and browser shims required by the pinned Midnight
runtime. The minimal composition is type-checked against RC5 tarballs; registry verification confirms
identical package contents. It is not a complete replacement for the reference app's bundler and UI configuration.

This minimal composition enables create/open/state only. Rotation and device changes require
verified holdings and complete device/read-grant sources. Grants additionally need live grant
sources and a durable encrypted publication journal. Unshielded withdrawals need a value-capable
call port; the fee-only sponsor cannot move those assets. See [Account API]({{ '/api/' | relative_url }})
before enabling another action. The [reference connector](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc5/apps/passport-dapp/src/connector.ts)
shows the fuller localnet composition, including those ports. Its `valueCalls` and
`grantJournalFactory` options are exported by RC5. Use the matching release source and SDK
version when copying this advanced composition.

## 5. Diagnose the first failure

| Symptom | Check |
| --- | --- |
| Package install returns 401/403/404 | Scope registry, token expiry/permissions, SSO where applicable, and the user's or consuming repository's access to the private package. Never paste tokens into logs. |
| `ArtefactIntegrity` / `NetworkMismatch` | Exact SDK versions, binding/manifest pin, independently pinned artefact URL and checked service network. Do not accept the server's pin to bypass the error. |
| Unsupported PRF or WebAuthn profile | Use a PRF-capable provider. Chrome's profile-only store is refused; the pinned `wa-json134` policy also limits assertion shapes. |
| Wallet shows an old balance | Choose **Refresh wallet balance** after indexer sync. Its timestamp is the local read time, not chain finality. Amounts are base units. |
| Funding failed or returned 409 | Keep the original request ID; inspect its durable reservation and live chain, then reconcile. Do not assume no transfer happened. |
| Rotation/device/grant action refuses missing ports or openings | Supply the documented chain-backed sources and durable host records. Do not substitute empty rosters for unavailable data. |
| A transaction outcome is uncertain | Keep the transaction hash, account address, network and public operation trace. Inspect settlement before resubmission. |

For handover, export public logs and report the installed version, binding, manifest, network and
service/image digests. Exclude PRF output, seed material, viewing secrets, grant openings and tokens.
Shielded partial spends remain refused; see [preview limits]({{ '/release-notes-rc5/' | relative_url }})
and the [Lace compatibility boundary]({{ '/lace-handover/' | relative_url }}).


## Optional operator host-job integration (unreleased)

For a trusted operator host/BFF, the [durable service-job runbook]({{ '/service-jobs/' | relative_url }}) describes opt-in encrypted reference-service settings, `remoteHostJobPorts` for the durable owner composition, explicit restart recovery and real HTTP/process tests. Client and service must both support identity hashes. Keep the bearer token out of a public browser page; portable browser imports do not make the token public. The default demo and published RC5 keep their existing behaviour.
