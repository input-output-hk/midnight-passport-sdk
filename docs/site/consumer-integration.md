---
layout: default
title: Consumer integration and qualification
permalink: /consumer-integration/
---

This guide covers the supported Passport integration boundary for #79 and #81.
The October 20 assessments below are historical, version-pinned host evidence.
RC6 packages their supported additions plus later durability and installed-consumer work;
see the [RC6 publication status]({{ "/release-notes-rc6/" | relative_url }}). The [historical report](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/lace-consumer-report.md)
retains its original source pins and transactions. Current authorised source pins,
private diagnostics and detailed receipts remain in the owner's private handover.
A public package install and a private source test are separate evidence.

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
continuation is supplied by the dependent durability slice, not by this foundation or published RC5. Even a protected continuation refuses a changed ledger frontier.

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
