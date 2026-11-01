---
layout: default
title: Consumer integration and qualification
permalink: /consumer-integration/
---

This guide covers the supported Passport integration boundary for #79 and #81.
The October 20 assessments below are historical, version-pinned host evidence.
The RC6 preview includes their supported additions plus later durability and installed-consumer work;
see the [RC6 release status]({{ "/release-notes-rc6/" | relative_url }}). The [historical report](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/lace-consumer-report.md)
retains its original source pins and transactions. Current authorised source pins,
private diagnostics and detailed receipts remain in the owner's private handover.
A public package install and a private source test are separate evidence.

## Current published host and RC6 — 2026/10/30

Local source now adds an opt-in, retained consumer check for the actual published
`@laceio/sdk@0.1.2-canary.2` and nine private SDK `0.1.0-rc6` packages. The
previous October20/canary0 assessment below is historical, not relabelled. Stable
host `0.1.1` does not export its Passport experimental entry; select the canary
explicitly. This qualification code is local follow-up work, not part of the
immutable RC6 npm artifacts.

The new check compares all **521 SDK files and 378 host files** with pinned
registry tarballs, then runs actual public entry types, cold ESM/CJS loads,
physical Compact/ledger identity, a WASM browser build and **13 synthetic transport
cases** through the public `createRemotePassportSeams` and installed SDK adapter.
The cases check original consent/session encoding, batch decoding, rejected
approval, failure/close handling, missing required fields, unsupported/lossy
flow refusal, module endpoint validation and signer-owned record presence.
They do not run the real signer handlers/page, a wallet operation, native proof
or provider ceremony. A separate authorised current-source type check passes;
its private source pin is retained privately and is not inferred from the canary.

### Adapters the current host requires

- Raw `PassportAuthoriser` is **not** assignable to the wider SDK authoriser:
  use `hostedJubjubAuthoriser` with the host's validated branded constructors and
  a lossless supported-flow conversion. Unsupported rotation and withdrawal
  descriptors remain refused before opening a session. Do not widen consent.
- A host `GrantScopeInput` may name a secp256k1 grantee. RC6's typed grant API
  accepts JubJub grantees only. The checked
  [scope example](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/examples/jubjub-grant-scope.ts)
  preserves the scope and explicitly refuses other schemes. Its companion bookkeeping
  mapper also refuses an explicit unsupported `granteeScheme`; structural record
  assignment alone can conceal that mismatch. `jubjubGrantInbox(hostViewing)`
  supplies the checked `openInbox` for SDK grant recovery and refuses decoded
  unsupported grant records too. Omitted legacy schemes denote JubJub.
  These helpers map already validated host data; it does not parse untrusted JSON or enable new circuits.
- Circuit-level proof ports and transaction proof ports remain different. A
  device/reader record still needs an explicit network/binding/counter mapping.
  Successful construction of a module is not a successful account operation.
- The canary's combined optional-peer metadata spans the two ledger generations.
  The tested exact composition retains peer warnings (its older
  abstractions range and a Polkadot util transitive range); no ordinary-wallet/Passport mixing is qualified. Do not
  suppress a strict peer failure or force a newer runtime to make a check green.

### Reproduce from verified published artifacts

Use Node/pnpm in the repository's Nix shell and a fresh private directory outside
this checkout. Obtain all nine RC6 tarballs through authorised GitHub Packages
access; `npm pack` them into a bundle with `manifest.json` containing the exact
nine `{name,file,sha256}` entries and `version: "0.1.0-rc6"`. Their hashes and SRI
must match the [RC6 signed receipt](https://github.com/input-output-hk/midnight-passport-sdk/releases/download/sdk-v0.1.0-rc6/rc6-publication-receipt.json).
Verify its detached GPG signature and fingerprint before pinning its SHA-256.
The script checks that hash and every package's hash/SRI; it does not authenticate
its own out-of-band pin or replace GPG/npm publisher verification.

Download the exact host tarball from its public npm metadata and independently
pin SHA-256 plus SHA-512 SRI. This run used host SHA-256
`97a8ddeef426e0245093e8be615ec523db9c8a5693a94d7e34fb61f9f29e4cb5`.
Use the checked [dependency example](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/examples/host-consumer-dependencies.json)
for this composition; it does not change SDK workspace dependencies. Set
registry authentication in a user-level configuration, then prepare:

```sh
export CONSUMER_ROOT=/private/path/to/new-consumer
export RELEASE_VERSION=0.1.0-rc6
export RELEASE_TARBALL_DIR=/private/path/to/verified-sdk-bundle
export SDK_PUBLICATION_RECEIPT=/private/path/to/rc6-publication-receipt.json
export SDK_PUBLICATION_RECEIPT_SHA256=6d58c1f85ee6901764f9013ec91b727a9a91485a86061e8f531e10e464e47af1
export LACE_PACKAGE_VERSION=0.1.2-canary.2
export LACE_TARBALL_FILE=/private/path/to/sdk-0.1.2-canary.2.tgz
export LACE_TARBALL_SHA256=97a8ddeef426e0245093e8be615ec523db9c8a5693a94d7e34fb61f9f29e4cb5
export LACE_TARBALL_INTEGRITY='sha512-piJkO/0jzB5h6c2R36r56vk5I563xRe/3hdt5FhapOcc4iUT+HyuDXHpMrhhOCbXSRz6Mhv0EtpaAnonYLGpyg=='
export CONSUMER_DEPENDENCIES_FILE="$PWD/docs/examples/host-consumer-dependencies.json"
nix develop -c node scripts/qualify-host-consumer.mjs prepare
```

Prepare prints the configuration SHA-256. Retain it independently; a config cannot
prove its own integrity. For an offline frozen replay in another fresh root, add
`CONSUMER_LOCK_FILE` and its externally checked `CONSUMER_LOCK_SHA256` before
prepare. Failed preparations remain intact. No install script or pnpm hook runs.

```sh
export CONSUMER_CONFIG_SHA256=<the-prepare-output-config-sha256>
nix develop -c pnpm qualify run consumer-host-integrity --output /private/path/to/new-suite.json
```

The scenario refuses modified config/lock/manifests, tarballs, missing/extra/changed
installed host or SDK files, and physical runtime divergence before importing a
host entry. It checks the same inputs and harness hashes after the run. Receipts
bind exact installed file hashes, lock, archive pins, public entry conditions and
case names. A completed output is never overwritten or silently rerun. Keep raw
private package-manager logs and locks outside shared artifacts; public summaries
contain hashes/outcomes only. This opt-in lane adds no registry install or WASM
build to the 30–45 second required CI jobs.


## Select a composition

| Need | SDK components | Host responsibility |
| --- | --- | --- |
| Contract and proof material | `contract`, key HTTP application | Verify binding, compiler/key hashes, circuit roster and network. |
| Portable key formats | `keys`, `account/ports` | Keep the PRF, reader secret and random viewing secret inside the key origin. |
| Chain calls and proving | `adapter-midnight-js`, optionally `adapter-service` and `service` | Supply a compatible transaction pipeline or circuit prover; preserve fee/deployment policy. |
| Hosted authorisation | `adapter-browser/hosted-jubjub` | Supply branded value constructors and an exact consent descriptor conversion. |
| Generic create/open/device/grant flows | `account` | Check that the key origin permits every operation the flow needs. |
| Browser passkey ceremony | `adapter-webauthn` for the P-256 route | Provider behavior and user approval remain separate from JubJub hosted-signing qualification. |
| Host-native wallet/module UX | The host's own module and orchestration | Choose one supported entry's declaration/module family, store adapter and consent sessions. |

A circuit prover accepting `(preimage, keyLocation, overwriteBindingInput?)` is
not the SDK transaction prover. A fee-only sponsor is not an arbitrary deployment
or value-transfer wallet. Neither substitution is justified by a similar method name.

## Keys and device loss

The device authoriser, device reader, ACC viewing secret and HD wallet seed have
different jobs. The reader is derived from a network-scoped PRF recipe. The live
ACC viewing secret is **random**, then sealed to enrolled readers. The account
flow receives public keys, ciphertexts and necessary opened records, not that secret.

A surviving enrolled device can open its envelope. An ACC address does not
reconstruct a lost credential. A password manager must restore the same credential
and PRF behavior for that credential's derived keys to return. This slice does not
qualify a provider's restoration promise or expose total-loss recovery.

The neutral SDK accepts unbranded identifiers. Host declarations may require
validated branded account, grant, counter and network values. Host-to-SDK structural
assignment can succeed while the reverse assignment fails. Keep an explicit adapter;
do not use unchecked casts in production to erase that distinction.

Earlier local notes mentioned an optional registration-history port; it has been
removed before publication. Such envelopes do not authenticate historical ledger keys.
Legacy interrupted removal can require operator reconciliation. The explicit protected
continuation is supplied by the opt-in RC6 durability API, not by the legacy foundation. Even a protected continuation refuses a changed ledger frontier.

## What the local checks establish

| Check | Scope | What it does not establish |
| --- | --- | --- |
| Nine packed SDK packages | Tarball SHA-256 before installation; entrypoints, strict application types, browser bundle, runtime identity and a verified prover restore | Publisher identity from an unsigned local manifest |
| Current authorised source | Exact clean Git object, matching generated ACC JS/declarations and seven directly shared Midnight versions | That this private source is the published canary |
| Published `@laceio/sdk@0.1.1-canary.0` with RC5 and local packs | Experimental and Midnight ESM/CJS entry loads, actual public declarations, same-entry Passport module composition, negative cross-entry composition and WASM browser build | Ordinary Midnight wallet transactions or arbitrary cross-entry module mixing |
| Key-origin/consent diagnostics | 36 synthetic tests: authoriser/reader derivation, copied-secret cleanup, bidirectional random-key envelopes and grant bookkeeping, plus original host ceremony and negative consent tests | Real signer-page, Google/iCloud or another browser/provider acceptance |
| Reduced key HTTP service | All pinned verifier keys; selected ten proving bundles; actual consumer loaders, SHA-256, CORS, range and tamper refusal | Other proving profiles or value-bearing grantee flows |
| Localnet protocol tests | Supported recognition directions and authorising-only device mutation with confirmed ledger reads | Full reader enrollment, total-loss recovery, partial shielded spends or full Lace compatibility |

Use the [compatibility matrix](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/compatibility.md)
for release boundaries. Separate wallet entries can carry different runtime and peer
dependency families. The public canary's combined peer metadata emits an abstractions
peer warning when the Passport runtime family is selected. Entry load/build success
does not qualify the ordinary-wallet operation family. Do not force a different
ledger/runtime into the ACC pipeline to suppress that warning.

### Retained consumer schema

The verified prepare/run CLI uses schema 2. It pins the preparation harness and
rechecks that same harness at run time, together with the physical paths and
complete file hashes of the selected Compact/ledger runtime packages, plus a
byte/link snapshot of the full installed dependency and tooling tree. A moved or
modified runtime, changed harness, or legacy schema requires a fresh scratch
consumer. Existing schema-1 receipts remain historical records. Runtime snapshots
detect drift; release signatures, the frozen lock, and registry integrity establish
their separate provenance boundaries. The smoke creates a start marker before the first installed import, so an interrupted
run is retained even if it produced no other output. TypeScript and Vite run through
the pinned Node executable; pnpm is used only for fresh preparation. The snapshot
covers installed inputs, with the Nix/Node and initial registry trust boundaries
still explicit. Inner entry hashes are checked against the
pinned host archive before the outer receipt is accepted.

## Reproduce installation and entry checks

Start with a fresh private scratch application and exact versions. Authenticate
GitHub Packages through your user credential configuration or credential manager.
With the repository's pinned pnpm, environment interpolation in project-level
registry credentials is refused; put the credential setting in the user auth file.
The non-secret scope-to-registry mapping can remain project-level. See
[pnpm authentication settings](https://pnpm.io/npmrc).

Install only the SDK packages the application uses in production. Qualification
installs all nine so it can check their dependency tree. For the consumer checks,
install TypeScript 6.0.3, Vite 6.3.6 and `vite-plugin-wasm` 3.6.0, and explicitly pin
the selected host's required peers. Keep the resulting lockfile. Inspect peer warnings;
do not turn broad canary peer ranges into evidence of transaction compatibility.
The browser probe uses the actual host import and WASM plugin, not an externalised stub.

From the SDK checkout:

```sh
CONSUMER_ROOT=/absolute/private/scratch-consumer \
LACE_PACKAGE_VERSION=0.1.1-canary.0 \
RELEASE_VERSION=0.1.0-rc5 \
CONSUMER_RECEIPT_FILE=/absolute/private/new-entry-receipt.json \
nix develop -c node scripts/smoke-lace-published-consumer.mjs
```

The runner checks installed versions, physical Compact/ledger identity, application
types against actual public declaration bundles, ESM/CJS exports and a WASM browser
build. It writes new scratch files and refuses to replace them. Use a new consumer
output directory for a rerun. The receipt hashes the lockfile and entry artifacts;
registry SRI, package visibility and release signatures are separate checks.

For a private source assessment, supply a reviewed **full Git SHA**, not `main`:

```sh
LACE_CHECKOUT=/absolute/private/disposable-lace-checkout \
LACE_SOURCE_REVISION=<reviewed-40-character-SHA> \
RELEASE_VERSION=<exact-local-pack-version> \
RELEASE_TARBALL_DIR=/absolute/private/nine-tarball-bundle \
CONSUMER_RECEIPT_FILE=/absolute/private/new-source-receipt.json \
nix develop -c node scripts/smoke-lace-source-consumer.mjs
```

The source check refuses tracked edits, untracked/ignored source overlays, a changed
ACC module and tarball hashes. A signed release manifest establishes publisher provenance;
a local pack manifest establishes only the relationship to its supplied files.

## Public-package native orchestration lane

The opt-in `consumer-host-native` lane exercises the actual public host module and
its store actions on the retained dedicated localnet. Clean signed source
`dd5034eafac8ef3103059b7b436bf66cd73a8386` passed **14 native cases** in 486,575 ms,
with 16 proof responses and 19 independently checked successful transactions in
canonical finalized blocks. Source/installed bytes matched before and after; all
three owned containers stopped. See the
[review map and exact receipts](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/review/public-host-native/README.md).

| Boundary | Observed support | Still separate |
| --- | --- | --- |
| Public host module | Create/activate, seven-unit deposit, populated read grant/rotation, sign-in and revocation | Signer page, real provider, wider arms and full wallet integration |
| Installed RC6 SDK | Same derivations, known-address reopen, qualified holding/grant, grantee seal and original-reader bookkeeping | Native SDK mutations through a hosted signer |
| Revocation | Inactive tombstone, holding preserved, historical seal refused for fresh key | Historical plaintext erasure, compromised-identity or total-loss recovery |
| Operator inputs | Canonical finality, verified keys, frozen source/installed bytes and owned cleanup | Production images and public-network acceptance |

The later lease fix has a real cross-process regression with different Nix temporary
directories. Native core/bootstrap bytes are unchanged; the receipt's measured source
is preserved rather than relabelled as a full native run at a later docs/lease commit.
A typecheck or fast guard test alone is **not** a native pass.

The target stays fixed at nine SDK packages `0.1.0-rc6`, public
`@laceio/sdk@0.1.2-canary.2`, and `acc-s3r1.1`. Start with the verified schema-2
consumer above and its independently recorded configuration hash. The runner checks
all installed SDK/host bytes, dependency links, runtime trees, and compiler inputs
before and after execution. Before any sponsor wallet starts, three distinct
node blocks must leave normal-transaction weight headroom after mandatory work.
A canonical, freshly indexed chain can still be unavailable for transactions while
its session/committee maintenance catches up after downtime. The development composition includes the public
`m.storageInMemory` and `m.featureDev` providers alongside the Passport module;
the upstream base store needs the feature provider even when no optional blockchain
feature is enabled. Production hosts should supply their upstream feature provider.
The runner subscribes to flow state before dispatch: public action processing is
asynchronous. It requires observed acceptance and a successful terminal result; a
dropped or uncertain action is never redispatched. It strictly compiles the flow against those installed
public declarations; there are no private host source aliases or production patches.

The intended checks are:

- Compare the host and SDK signing/reader derivations before any account operation.
- Create and activate an ACC through public `createLaceWallet` and its Passport
  module, with a pre-existing synthetic PRF credential and sealed private records.
- Deposit **7 smallest NIGHT units**, then verify the holding against chain output
  history. Ledger-v9 intent identifiers are 33 bytes (66 hex characters, including
  the `00` discriminator); transaction hashes are 32 bytes. Resolve the identifier
  to a successful canonical hash before accepting funding. The development deposit wallet starts only after the fee wallet stops.
- Issue a bounded JubJub read grant with explicit `rpId: "localhost"` matching
  the synthetic credential, open its sealed capability with the SDK, and
  verify that rotation preserves the holding.
- Refuse an unrelated reader, reopen the host-created ACC by address through RC6,
  verify its holding and live grant, and recover the original reader's authenticated
  published bookkeeping through the checked inbox adapter.
- Reconnect the host, revoke the read grant, and verify the SDK sees the inactive
  tombstone, preserves the holding, and refuses the historical seal for the fresh key.
- Independently verify successful contract actions against canonical finalized node
  blocks. Stop only the three owned containers this invocation started.

The SDK account transaction ports deliberately refuse proving, sponsorship,
submission, and deployment in this lane. Its native transactions belong to the public
host module; the SDK crossover covers reads, key derivation, capability decoding,
and bookkeeping. This does not qualify native SDK mutation through a hosted signer,
real browser/provider ceremonies, ordinary-wallet entry mixing, Docker service
images, compromised-device retirement, or partial shielded spends. Existing consent
and exact-value guards remain unchanged.

Prerequisites: Docker with at least 24 GiB memory, 15 GiB free disk, the stopped
retained `mn-passport-qual-20261023` project on ports 19954/18098/16310, an existing
verified flat prover-key cache for `jubjub-owner-v1`, and free loopback port 18798.
The node and canonical indexer volumes are preserved. The key server verifies the
ten existing prover keys and serves all 52 bundled verifier keys; it never regenerates
missing keys. The public standalone genesis wallet is used only on that dedicated
`undeployed` chain. An active stack or an existing native output directory is refused.

```sh
CONSUMER_ROOT=/absolute/private/verified-consumer \
CONSUMER_CONFIG_SHA256=<independently-recorded-config-SHA256> \
PASSPORT_HOST_NATIVE=1 PASSPORT_RC_LOCALNET=1 MN_NETWORK_ID=undeployed \
PASSPORT_HOST_NATIVE_ROOT=/absolute/private/verified-consumer/native-signed-run-1 \
PASSPORT_KEY_DIR=/absolute/path/to/verified/prover-keys \
nix develop -c pnpm qualify run consumer-host-native \
  --output /absolute/private/new-native-suite-receipt.json
```

Commit and GPG/DCO-sign the harness first: dirty source is refused. Failed and
interrupted roots, encrypted deployment records, synthetic key material, and
uncertain transactions are retained privately. Each fee-balanced transaction is
saved before the host may submit it, alongside public hashes/identifiers and the
node runtime's cost/normal-class limits. An overweight transaction is refused before
submission; passing this preflight alone does not establish block inclusion. They are never copied into the
knowledge base or public evidence. A process lease under `~/.midnight-passport-native-qualification/` prevents concurrent
runs even when Nix gives each shell a different `TMPDIR`; if it
survives a crash, inspect its PID and recorded source before operator cleanup.
Never clear a lease or replace a request/fixture merely to force another attempt.
Only sanitised receipts and public transaction/block hashes belong in the handover.
This slow lane stays outside required fast CI.

## Reproduce protocol diagnostics

Use a disposable authorised source checkout with its dependencies installed in the
same tree as the scratch consumer. Install the host's declared dependencies, including
those reached through workspace libraries; a sparse checkout alone is insufficient.
The runner computes workspace aliases from manifests without editing implementation,
Nx or signer configuration. It temporarily adds only its own diagnostic test files,
uses a fresh Vitest config without Nx result caching, and removes its own files afterward.
Existing diagnostic files are never overwritten.

Set `LACE_CHECKOUT`, `LACE_SOURCE_REVISION`, `CONSUMER_ROOT`, `RELEASE_VERSION` and
`RELEASE_TARBALL_DIR` as above, plus `LACE_DIAGNOSTIC_CHECKOUT=1`. Then run:

```sh
nix develop -c node scripts/run-lace-consumer-flows.mjs ports
```

Other modes are opt-in:

- `keys`: set `PASSPORT_KEY_SERVICE_URL` to an existing loopback **reduced-profile**
  server. `KEY_HTTP_RECEIPT_FILE` optionally records requested public paths, sizes
  and hashes. The suite downloads about 530 MB; it does not regenerate keys.
- `hosted-device`: set `PASSPORT_LACE_HOSTED_E2E=1`, `PASSPORT_CONTRACT_DIR` and
  `PASSPORT_SERVICE_URL`. Creates a disposable SDK ACC using local key-origin ports,
  then tests hosted sign-in, authorising-only addition and subsequent recognition.
- `reverse-open`: the same inputs plus `PASSPORT_SDK_ROOT`. Keeps native hosted
  creation and opens the address through SDK local key-origin ports. Set
  `PASSPORT_LACE_ARTEFACT_URL` to exercise a selected key HTTP endpoint.

`CONSUMER_RECEIPT_FILE` records the bounded protocol outcome; live modes can also
write a redacted `LIVE_CONSUMER_RECEIPT_FILE`. Use a new output path each time.
The localnet modes spend public standalone test-wallet fees and can take minutes.
They never start/reset a chain or operate real passkeys. Keep the network `undeployed`,
the immutable binding, fresh disposable accounts and existing sponsor restrictions.
Do not retry an uncertain value-bearing operation under a new request ID.

Use one physical runtime tree for each process, including generated ACC module
imports. Symlinking generated JS into a different dependency tree can reintroduce
class identity failures even when every manifest says the same version. Byte-only
process boundaries are appropriate for an independently installed wallet worker.

`pnpm qualify plan consumer-source` and `plan consumer-published` expose the two
non-localnet assessment suites. Neither is part of the fast required PR gate.
The small input-integrity and runtime refusal regressions run in normal CI;
registry, proof and host checks remain explicit qualification work.

## Historical-registration API correction — 2026/10/24

The optional `readDeviceRegistrationHistory` port mentioned in earlier local notes
has been removed. Earlier readable secrets are not authenticated historical ledger
keys. Hosts must not use them to identify a removal target or fresh-key recipient.
Legacy interruption may require operator reconciliation; the next durability slice
adds an explicit protected original continuation. No legacy automatic retry is claimed.

## Installed candidate interruption qualification

The opt-in `consumer-installed` suite extends #81/#231 with a retained application
outside the workspace. It installs all nine local candidate tarballs, compares
**every installed SDK file byte** with its supplied tarball, checks one physical
copy of the pinned Midnight runtime family, and reuses an unchanged lockfile for
an offline frozen install. A local manifest authenticates its file relationships;
it does not establish registry publisher identity or release provenance.

Prepare a new private path whose parent already exists. The first preparation may
resolve/download external dependencies; lifecycle scripts and pnpmfile hooks are
disabled. No registry publish occurs. Use the repository's Nix shell throughout:

```sh
CONSUMER_ROOT=/absolute/private/new-consumer \
RELEASE_VERSION=<exact-local-pack-version> \
RELEASE_TARBALL_DIR=/absolute/private/nine-tarball-bundle \
nix develop -c node scripts/qualify-installed-consumer.mjs prepare

CONSUMER_ROOT=/absolute/private/new-consumer \
nix develop -c pnpm qualify run consumer-installed \
  --output /absolute/private/new-qualification-receipt.json
```

For a second fresh application, set `CONSUMER_LOCK_FILE` to the first application's
`pnpm-lock.yaml` and `CONSUMER_LOCK_SHA256` to its recorded SHA-256 during `prepare`.
That preparation uses `--offline --frozen-lockfile`; a missing cached dependency is
a failure. `CONSUMER_MANIFEST_SHA256` can pin the supplied bundle independently.
`run` also accepts external manifest/lock hashes and refuses a different retained
version or Node runtime. Keep the lockfile and `qualification-inputs.json` together;
only hashes belong in a public handover if private dependencies appear in a lock.

Each run creates fresh synthetic fixtures and checks eight cases: both authoriser
arms × call/deployment × two interruption boundaries. A real loopback HTTP worker
is killed after the job is claimed before host execution, or after the last
synthetic submission is durably recorded before acknowledgment. A fresh process
uses the installed client/service packages and the original job identity.

| Boundary | Required result | Safety check |
| --- | --- | --- |
| Claimed job, no host record | Original remains `unknown` | No preparation, execution or submission during reconciliation. Missing host state never proves no send. |
| Recorded submission, lost acknowledgment | Original becomes `done` | Ledger bytes unchanged; no recovery preparation or submission. Deployment has two synthetic steps. |
| Repeated original resume / conflicting input / unauthorised request / missing GET | Original outcome preserved; conflict and authentication refused | No replacement ID, legacy fallback or additional effect. |

A separate installed hosted-JubJub adapter probe preserves the full supported
consent descriptor, refuses a lossy converter, and refuses rotation and shielded/
unshielded withdrawals that lack a hosted consent descriptor. Rejected operations
never open a host session or request secret material. This uses a **synthetic
host**, not Lace's signer page, branded constructors or a real provider.

The inner `runs/<run-id>/receipt.json` records bundle/lock/harness hashes, all nine
SDK file inventories, runtime names, cases and explicit negative scope flags.
The outer qualification receipt binds the invoking checkout and binding. Modified
installed files, archive traversal/links, altered bundles or locks fail before a
new scenario starts. Failed runs and intentional unknowns remain private and are
never relabelled; use fresh fixtures instead of replacing their intents. Workers
own only ephemeral loopback sockets and terminate on success/failure; no Docker,
real wallet, proof server, hosted signer or existing demo is used.

This does **not** extend native proof acceptance, verify every transitive dependency
byte, qualify Google/iCloud restoration, establish actual-registry provenance, or
claim full Lace compatibility. It does not enable new owner operations or partial
shielded spends. Installation/restart runs remain outside required fast PR CI;
archive-integrity and receipt-refusal controls run in the ordinary test gate.
