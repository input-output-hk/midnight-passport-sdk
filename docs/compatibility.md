# Compatibility matrix

> **Status:** preview RC5 · updated 2026/10/20. Releases are lockstep across the
> `@input-output-hk/mn-passport-*` packages. The binding data is pinned in
> `packages/contract/acc-binding-v2.generated.json` and the generated registry.

The [RC5 publication receipt](release/rc5-publication-receipt.json) records the signed source,
private registry hashes/attestations, and published image digests. The release keeps the exact-value
shielded withdrawal guard. Partial spends (#201), complete typed circuit coverage (#82) and
remaining live/value-host evidence (#202) are deferred; no full Lace compatibility is claimed.

## 2026/10/20 local consumer assessment

The [current consumer review](review/consumer-qualification/README.md) and
[engineer guide](site/consumer-integration.md) distinguish local packages, the actual
published `@laceio/sdk@0.1.1-canary.0` entries and a separately pinned authorised
source checkout. All nine RC5 packages remain private and pass a fresh registry
consumer installation with matching release SRI. Nine local `0.1.0-consumer.1`
tarballs also pass; that candidate has not been published.

Current source-type/ACC byte checks, 36 synthetic key/consent checks, both supported
recognition directions and an authorising-only hosted device mutation pass on
`undeployed`. Current-source pins and detailed private evidence stay in the owner's
authorised checkpoint. Historical rows below retain their original scope.

The local key-server fix keeps all bundled verifier keys available in a reduced
proving profile. Native creation and the current host's actual HTTP loaders pass
against that correction. **The published RC5 reduced-profile image does not contain
this fix: use `all` until the next image release.** The correction changes no binding,
proving key, signing scope or exact-value shielded guard.

Public-entry ESM/CJS loads, real declaration boundaries, current physical runtime
identity and WASM browser builds pass. The canary's combined abstractions peer warning
remains documented. This is not an ordinary-wallet transaction qualification, full
reader enrollment, real-provider/signing-page acceptance or full Lace compatibility.

## Binding axis

| SDK | ACC binding | Passport source | Compiler | Language | Runtime (`@midnight-ntwrk/compact-runtime`) | Compiler manifest SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| `0.1.0-rc1` | `acc-s3r1.1` | `6458ed5` (P-256 plus caller-pinned grants) | 0.35.0 | 0.27.0 | 0.20.0 | `77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f` |
| `0.1.0-rc4` | `acc-s3r1.1` | `6458ed5` (P-256 plus caller-pinned grants) | 0.35.0 | 0.27.0 | 0.20.0 | `77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f` |
| `0.1.0-rc5` | `acc-s3r1.1` | `6458ed5` (P-256 plus caller-pinned grants) | 0.35.0 | 0.27.0 | 0.20.0 | `77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f` |

The package registry supports only `acc-s3r1.1`. The older provisional
`0.0.0-prototype.1` binding is retired. The separate `acc-45721e1` key bundle
remains in `mn-passport-contract` for prototype archive work, but the SDK does
not deploy or resolve it. All supported bindings in this release use the same
Compact runtime.

## API axis

| SDK | Account API (`PASSPORT_API_VERSION`) | Service API (`PASSPORT_SERVICE_API_VERSION`) |
| --- | --- | --- |
| `0.1.0-rc1` | `1.0.0-pre.0` | `1.0.0-pre.0` |
| `0.1.0-rc4` | `1.0.0-pre.0` | `1.0.0-pre.0` |
| `0.1.0-rc5` | `1.0.0-pre.0` | `1.0.0-pre.0` |

The local demo service was not a published SDK package in RC1. The service API
constant names the versioned client wire types; the current prototype browser
uses the `/v1` config, deployment, proving, sponsorship and directory routes.

On 2026/10/15 the prototype browser created a JubJub account against the pinned
`acc-s3r1.1` binding on an isolated localnet, activated its first device, then
reopened the same account after a page reload with the development mock passkey.
The reference ACC `test:auth-coinless` also passed with both enrolment directions
and an on-node JubJub-authorized gated call. This validates the local SDK
composition; it does not establish interoperability inside Lace's hosted module.

On 2026/10/15, SDK commit `9ec6c005a9568731f8bf2eee9cb9c4d778203532`
was run through the one-command demo on the `undeployed` localnet with the pinned
`6458ed5` ACC export and manifest above. The full 52-key cache verified before
startup. With `--mock-passkey`, the P-256 arm completed ten deploy waves,
activated its first device, and reopened account
`b814ed4f4e8bfe5b8f9ee3df5921f48a364d899d5389c3f4f70813f1fd40497a`
after a page reload; its built-in read-only wallet also connected and synced.
The separate `--arm jubjub` run deployed, activated, and reopened account
`535a22b14932ca454c7abefd1c7471c8f3b58d6d81dc8a9a233af02c73800800`.
Both reopened ACCs showed one live device and auth nonce 2. The standalone key
server advertised the `all` profile and returned HTTP 206 for a 32-byte range
of the pinned `deposit_unshielded.prover`. These local mock-passkey runs do not
test a real authenticator, grants, recovery, or Lace-hosted transaction paths.

The Chrome CDP virtual authenticator exposed a strict-profile browser mismatch
on 2026/10/17: [Chromium sometimes adds its signed GREASE member](https://chromium.googlesource.com/chromium/src/+/f207f132b656e084dc8ae12c7b4f0f54043aefdd/content/browser/webauth/client_data_json.cc#160) to
`clientDataJSON`, while the pinned `wa-json134` ACC accepts one exact byte
layout. The WebAuthn adapter now retries only that known variant, up to five
times, without rewriting signed bytes. Unknown layouts still fail closed. A
virtual-authenticator localnet run and manual Google/iCloud provider runs are
separate evidence gates; this retry does not change the on-chain format. The full
Chrome CDP run passed on `undeployed` on 2026/10/17: create, two rotations,
reload/open, wrong-credential refusal and wallet connection used 19 WebAuthn
assertions against ACC `3ae05ff57a8ad4fd76a9e8e3cef3041200882c1b06d6d058c4f4a3cc5c26469a`.

## Lace consumer seam check

The [Lace consumer report](lace-consumer-report.md) maps each SDK package to the
merged Lace module, its required adapters and the still-open runtime gates.

The SDK keyring writes Lace's current suite `0x02` envelope (`0xd1`), JubJub
device registration (`0xd2`) and grant record (`0xd3`) formats. Exact known-answer
bytes from PR #2845 at the pinned head below pass in both directions: the SDK
opens Lace's records and writes the same bytes with fixed randomness. The SDK
also opens its earlier suite `0x01` records. This is wire compatibility, not
a cross-product live account test.

The local `0.1.0-dev.10` pack of all nine packages passed the tarball consumer
smoke, including a scratch browser build and a hash-verified key restore. The
exact-source Lace consumer type check passed against merged PR #2845 at
`502b0794cc7bcfc76342230193fef4ebb63cae1c`; seven direct Midnight runtime
dependencies have the same versions in both modules. These are local pre-tag gates;
the `dev.10` packages were not published. The scratch browser bundle includes runtime
0.20.0 for the pinned ACC and runtime 0.16.0 through `compact-js@3.0.0-rc.3`'s
explicit `compact-runtime-ledger8` alias. That alias is the upstream Ledger 8 path,
not a second copy of the Ledger 9 runtime. The current Lace/SDK host still needs a
full module runtime and bundle audit before claiming complete hosted compatibility.

The SDK adds
type `0xd5` for a compressed 33-byte P-256 authoriser key and its WebAuthn
policy under a distinct encryption domain. The earlier `0xd4` key-only record
can still open, but lacks the policy needed to resolve another live P-256
device. The browser's P-256 create/open flow uses a random,
sealed viewing secret and publishes its entries on chain. Lace PR #2845 reads
only the JubJub registration. The P-256 record is therefore an SDK extension,
not evidence of Lace runtime compatibility. SDK-side P-256 rotation and
second-device recovery have since passed on the pinned localnet; Lace-hosted
runtime validation remains open.

The structural fixture in `tests/fixtures/lace-seams.mjs` was copied from
[lace-platform PR #2845](https://github.com/input-output-hk/lace-platform/pull/2845)
at `cdfa9cfd81a0adcc0a7224aa624f18e52494f602` (2026/10/15), from
`packages/contract/passport/src/types.ts`. `tests/account-ports.test.mjs` checks
the structural TypeScript assignments. A second local check now compiles the
**actual contract seam sources**, generated ACC ledger declaration, and gated-call handle type from that exact Lace commit against all nine
packed SDK tarballs. It checks the tarball SHA-256 values in the release
manifest, then compiles Lace's `PassportAuthoriser`, `PassportEncryptionKey`,
`FeeSponsor`, `PassportProver`, network config, account store record, grant record,
grant scope, bookkeeping, ledger, and transaction-handle
types with `tests/fixtures/lace-source-consumer.ts`. To reproduce with an exact
Lace PR checkout and a fresh nine-package pack:

```sh
RELEASE_VERSION=0.1.0-dev.7 DIST_TAG=dev \
  RELEASE_TARBALL_DIR=/path/to/empty-pack-dir \
  nix develop -c node scripts/release-packages.mjs pack
LACE_CHECKOUT=/path/to/lace-platform \
  RELEASE_VERSION=0.1.0-dev.7 \
  RELEASE_TARBALL_DIR=/path/to/empty-pack-dir \
  nix develop -c node scripts/smoke-lace-source-consumer.mjs
```

At this Lace head, the grant scope no longer accepts rolling windows, matching
the pinned ACC binding. Lace also validates stored openings against the live
ACC object commitment and read-key hash before reusing them. The SDK's
chain-backed `GrantCommitmentSource` supplies those values; both JubJub and
P-256 publication verify the staged opening and auth nonce before appending
sealed bookkeeping. The packed source check also compiles `createHostedAccChain`
with Lace's exact generated ledger and gated-call handle types. This does not
establish Lace-hosted runtime compatibility.

The check pins Lace HEAD to `502b0794cc7bcfc76342230193fef4ebb63cae1c`
and rejects local edits to its contract seam, ledger declaration, and gated-call
handle. The Lace source dependencies
`type-fest@4.41.0`, `ts-custom-error@3.3.1`, `@reduxjs/toolkit@2.11.2`, and
`immer@10.2.0` match its lockfile. The result
is a source-level compile check, not a build of Lace's module or a live
transaction. It establishes direct structural compatibility for the sponsor,
viewing key, grant scope, bookkeeping, and the hosted ACC reader/call bridge. The browser package now exports
`./hosted-jubjub` with `hostedJubjubAuthoriser`: it converts tagged account/epoch/counter inputs,
compresses and validates the device key, and carries the signing request to
Lace's hosted signer without forwarding the SDK-only challenge. The host
supplies Lace's tagged constructors and a consent-flow converter. The adapter
rejects absent key sessions, non-JubJub circuits, unsupported rotation, and
any converter output that changes a consent field. The exact-source fixture
compiles that adapter with Lace's current `PassportAuthoriser`. The
circuit-level prover can run through Lace's existing transaction handle via
`createHostedAccChain`; its real hosted runtime still needs validation. Network
config additionally needs the ACC binding and manifest pins.

A separate [localnet probe](../experiments/acc-0.35/sdk-shielded-deposit-node.mjs) now submits
`deposit_shielded` through `createHostedAccChain` and the pinned reference ACC's actual
`callTx` handle, then confirms and opens the inbox entry. The [run record](../experiments/acc-0.35/results/sdk-shielded-deposit-node.json)
pins the transaction, contract source and manifest. At Lace head above, its vendored
`acc/generated/index.js` is byte-identical to the SDK's `acc-s3r1.1` generated module.
This exercises the hosted handle adapter on a real node; it does not run Lace's
authoriser, storage, consent or full module composition. Those remain the runtime
acceptance gate for #81.

Lace's `PassportAccountInfo` records address, binding version, network and
readiness; the SDK's device-local `AccountRecord` additionally needs the active
authoriser arm and local use counter. The consumer fixture checks a mapping
that validates network, binding and readiness before setting those device-local
fields. Lace's `GrantRecord` has `active` and `scope.read`, but an SDK
`GrantDetailSource` also needs `authNonce` from the same live ACC snapshot;
stored grant data alone cannot supply it.

On 2026/10/15, SDK commit `df5b550b46222bf797af1dec732c8b5633e53f55`
was packed locally as nine `0.1.0-dev.5` tarballs. The expanded exact-source
check passed against Lace PR #2845 at the pinned head above. The release
consumer smoke loaded the tarballs, built a scratch browser app, and restored
and hash-verified `deposit_unshielded`. This is local validation, not a registry
release or a Lace-hosted runtime test.

On 2026/10/15, SDK commit `adae47a39fe2baf9e6a55719a615f6cdae3479e0`
was packed locally as nine `0.1.0-dev.4` tarballs. The exact Lace source
check passed against PR #2845 at `cdfa9cfd81a0adcc0a7224aa624f18e52494f602`.
The release consumer smoke loaded all nine packages, checked Lace-shaped
host types, built a scratch browser app, and restored and hash-verified the
pinned `deposit_unshielded` key. These are local checks, not a registry
release or a Lace module runtime test.

On 2026/10/15, SDK commit `8905dbcb29d48959075768c34a85682ab8ccd6be`
was packed locally as nine `0.1.0-dev.2` tarballs. The exact Lace source check
passed against PR #2845 at its earlier `05e1e3d` head. The release consumer smoke also loaded all
nine entry points, compiled the Lace-shaped host fixture, built a scratch Vite
browser app, and restored and hash-verified the pinned `deposit_unshielded`
key. This `dev.2` pack was local validation, not a registry release.

On 2026/10/15, SDK commit `9e31aeeaeb90f9f355162e368a90c6fce4238bd8`
was packed locally as nine `0.1.0-dev.3` tarballs. The release consumer smoke
loaded the packages, compiled the Lace-shaped host fixture, built a browser
bundle, and hash-verified a restored `deposit_unshielded` key. The exact Lace
source check passed against PR #2845 at its earlier `05e1e3d` head. These are
local checks, not a registry release or a Lace module runtime test. TypeScript
accepts direct structural assignment of Lace's authoriser; the hosted adapter
still handles runtime branding and rejects unsupported consent descriptors.

The scratch browser build emitted ledger v8 and v9 WASM assets. Dependency
inspection found one `@midnightntwrk/ledger-v8@8.1.2` and one
`@midnightntwrk/ledger-v9@1.0.0-rc.5` in the SDK adapter path: upstream
`midnight-js-protocol@5.0.0-rc.2` supports both ledger generations. These are
two different protocol runtimes, not duplicate copies of one version. Lace's
own module bundle and hosted transaction path remain to be measured.

On 2026/10/15, the pinned `6458ed5` ACC was deployed on the Passport localnet
with a software P-256 passkey. The SDK's `createHostedAccChain` submitted
`add_device_with_p256` through the reference client's funded transaction handle.
The live ledger contained the new device entry and advanced `auth_nonce` from 0
to 1. The [probe](../experiments/acc-0.35/sdk-p256-hosted-enroll-node.mjs) and
[evidence](../experiments/acc-0.35/results/sdk-p256-hosted-enroll-node.json)
pin the compiler manifest and transaction. This validates the hosted chain
bridge and enrollment circuit. It does not exercise the account API's sealed
key delivery, active read-grant rotation, or Lace's WebAuthn and transaction
host; those remain release validation work.

The [current account API probe](../experiments/acc-0.35/sdk-p256-sealed-device-node.mjs)
then exercised `createPassportAccounts` over the service-backed prover and sponsor
on the same pinned localnet. It created a sealed P-256 ACC, published its two
creation entries, delivered two sealed entries to a second P-256 device, enrolled
that device, and opened the account independently with the joining device's
PRF-derived reader key. The [evidence](../experiments/acc-0.35/results/sdk-p256-sealed-device-node.json)
records the six account calls and the live roster change. The chain-backed grant
adapter observed an empty read-grant roster. A transient reset while polling
a proof job exposed an adapter gap: the v1 service client now retries that GET
with the same cursor, without submitting another proof or replaying events.

A second [account API probe](../experiments/acc-0.35/sdk-p256-read-grant-enroll-node.mjs)
issued an active read grant through the P-256 owner API, checked its read public
key against the live ACC grant hash, then enrolled a second P-256 device. The
owner flow rotated the viewing key, published a fresh seal for that grant,
preserved the grant-map entry, and delivered the new key to the joiner before
enrollment. The read grantee opened the initial and replacement seals against
their respective live ACC encryption keys; the initial seal was rejected after
rotation. The joiner opened the account by address. The [localnet evidence](../experiments/acc-0.35/results/sdk-p256-read-grant-enroll-node.json)
records the 15 transaction IDs and the asserted grant and ACC state. The probe's
opening journal lives only for that run; production hosts still need durable
grant openings and a chain-backed holding source. This validates the SDK
composition on its own service, not Lace's hosted runtime or real WebAuthn.

A [mixed-device probe](../experiments/acc-0.35/sdk-mixed-device-recovery-node.mjs)
then enrolled a JubJub reader from a sealed P-256 owner account on the same
pinned localnet. The owner published a type `0xd2` registration and signed
`add_device_with_p256`; the joiner verified its live JubJub entry and current
registration, opened the ledger-matched sealed viewing key by address, saved
its hint, and reopened through `openAccount()`. The [evidence](../experiments/acc-0.35/results/sdk-mixed-device-recovery-node.json)
records six proof-backed account transactions. This covers a surviving
JubJub device without a preexisting directory hint, using software passkeys
and an empty read-grant roster. Mixed-device rotation with active grants and
Lace's hosted runtime remain separate validation gates.

| Lace seam | SDK port | Current result |
| --- | --- | --- |
| `FeeSponsor.balanceAndSign` | `FeeSponsor` | Direct structural assignment |
| `PassportEncryptionKey` | `AccountViewingKey` | Direct structural assignment for reader, keyring, inbox, and grant operations |
| `readGrants` plus stored grant openings | `ActiveReadGrantTargetSource` | `createMidnightGrantSource` reads the complete pinned ACC roster at one auth nonce and verifies each available read key against the on-chain hash; Lace still supplies its durable opening store and a same-network provider |
| `readGrants` active IDs for issue | `ActiveGrantSnapshotSource` | The same adapter returns IDs and auth nonce from one ledger snapshot; the SDK checks them against its signing view and rechecks before staging. Lace still owns the consent and durable grant journal. |
| `PassportNetworkConfig` | `NetworkConfig` | Lace network fields fit; the SDK caller must supply its additional ACC binding and manifest pins |
| `PassportAuthoriser` | `Authoriser` | `hostedJubjubAuthoriser` supplies the boundary for branded account/counter/epoch values and request encoding. The host supplies tagged constructors and a lossless consent converter. Its packed type check and focused runtime tests pass; no Lace-hosted transaction has been proven yet. |
| `PassportProver.prove/check` | transaction `Prover.proveTx` | Different abstraction. `createHostedAccChain` accepts Lace's existing decoded ledger reader and ACC transaction handle, so a host can keep its own circuit prover and transaction pipeline. The adapter validates the ACC binding and finalized result; a Lace-hosted runtime transaction still needs to be exercised. |

The current Lace `KeySessionFlow.kind` omits `rotate-encryption-key`, which the
SDK's standalone rotation flow requests. The test adapter rejects that direct
operation until Lace and the SDK agree on its consent descriptor. Read-grant issue
and revoke-all now run rotation within their approved owner session, so they do
not request a second, unsupported rotation descriptor. The SDK's JubJub rotation prepares
read-grant seals before switching the ACC key, but Lace must supply a chain-backed
grant target adapter with the exact auth nonce and its own consent path. The SDK's
JubJub account read uses Lace's `read-holdings` descriptor and a host-injected
chain-backed holding source. JubJub removal uses Lace's `remove-device` descriptor and rotates
the viewing and roster keys before the pinned removal circuit; it refuses a surviving reader
that shares a key with the removed device. These owner flows have binding-focused tests but have
not run in Lace's hosted module, so they are not yet verified Lace flow replacements.
Durable interrupted-rotation recovery remains. The SDK's `issueGrant`, `revokeGrant`, and
`revokeAllGrants` expose settled owner calls; read issue rotates before the issue circuit and
publishes the new grantee seal after settlement, while read revoke rotates and excludes that
grantee. Revoke-all rotates away from every read grantee before clearing the map. Issue pins the origin in the host and stages durable grant
bookkeeping. Lace still needs hosted runtime validation before adopting these flows. The SDK's
`addDevice` uses Lace's `add-device`
descriptor with a reader and delivers keys before enrollment. If a read grant is live it rotates
the viewing and roster keys first, re-encrypts verified holdings, and reseals each active grant
inside the same key session. The binding-focused tests cover success, unsafe roster and grant
refusal, and retry after an interrupted enrollment; Lace's hosted module has not run this flow.
Its lower-level `addJubjubAuthorisingDevice` remains authorisation only.

The older SDK `EncryptionKeySource.publicKey` port is a prototype key source;
Lace's `PassportEncryptionKey` matches the newer `AccountViewingKey` instead.
The release preflight now installs the packed SDK tarballs in a scratch host,
compiles these Lace-shaped seams against the installed account-port types,
loads the entry points, and builds a browser bundle. This checks packaging and
type resolution. The separate exact-source check above uses Lace's contract
types, but neither check builds Lace's own module.
The next release still needs Lace-hosted flow interoperability and the required
owner/circuit flows before claiming full Lace compatibility.

The nine development packages were packed as `0.1.0-dev.10` and passed the
scratch Vite/key-restore release smoke test and an exact-source consumer type
check against Lace PR #2845 head `cdfa9cfd`. This validates the package
boundary and generated binding types, but not a Lace-hosted transaction. The
owner unshielded withdrawal API is available for P-256 and JubJub; Lace's
current `KeySessionFlow` has no withdrawal descriptor, so its hosted JubJub
authoriser rejects that flow until the host adds explicit amount and recipient
consent.

The owner shielded withdrawal flow now binds one chain-matched qualified coin,
including its Merkle index, to the P-256 or JubJub challenge and per-call
`held_coin` witness. The current owner API requires an exact coin-value spend
until change capture and republication are available. The SDK's transaction
chain adapter can carry the witness; a proof-backed P-256 exact spend was accepted
on the localnet using a value-capable wallet for fee balancing and submission.
The Passport service's fee-only sponsor rejects shielded offers and cannot submit
this call. Lace PR #2845's hosted handle and key-session flow do not yet expose
the required witness and withdrawal consent, so the hosted JubJub adapter
rejects this operation. Partial change settlement, spent-output reconciliation
and a JubJub live proof are deferred to the next RC. The exact-value guard
remains enabled: callers must not offer a larger coin and assume change is
captured. The v9 wallet route passed a live P-256 proof, but Lace's hosted
route, consent, witness delivery, and a JubJub live proof remain unverified.

## Axes and releases

Added 2026/10/08 ([ADR 0006](./adr/0006-publish-on-github-packages.md),
[ADR 0007](./adr/0007-package-set-ports-and-flows.md); publishing design
[§3.5 and §6.5](./superpowers/specs/2026-10-07-passport-sdk-packages-design.md)).
The account API and the service wire types are versioned separately.

| Axis | What it versions | Where | Breaking change means |
|---|---|---|---|
| API | The account API, descriptor, error codes and progress events (`PASSPORT_API_VERSION`); the service's HTTP wire (`PASSPORT_SERVICE_API_VERSION`, path prefix `/v1`) | `mn-passport-protocol` | A removed or changed member, field, code meaning or endpoint |
| Binding | The deployed ACC's circuit shape: binding id, manifest hash, Compact runtime | `mn-passport-contract` registry; `mn-passport-account` support | Dropping a binding, or moving the Compact runtime (all bindings in a release share one, FS-0.9 D-6) |

- **Lockstep.** Every `@input-output-hk/mn-passport-*` package shares one version
  per release. A major bump on either axis is a major release. A minor
  release may add optional fields, methods, error codes, progress steps,
  endpoints and bindings. A patch changes no contract.
- **A new binding is a minor release of every package.** The contract package
  gains the artefact and its registry entry (manifest hash committed, ADR
  0004), the account package gains its catalogue entries, and the matrix gains
  a row, in one release.
- **Before 1.0** releases are `0.y.z`: a minor may break, a patch may only add.
  1.0.0 is cut when lace-platform integrates.
- **Binding ids** follow FS-0.9 D-5: `acc-s<spec_version>r<recovery_version>.<n>`.
- **The release matrix** has one row per release.

| SDK | API version | Service API version | Supported bindings | Binding for new accounts | Compact runtime | Midnight package set |
|---|---|---|---|---|---|---|
| `0.1.0-rc1` | `1.0.0-pre.0` | `1.0.0-pre.0` | `acc-s3r1.1` | `acc-s3r1.1` | `0.20.0` | midnight-js `5.0.0-rc.2`, ledger-v9 `1.0.0-rc.5` |
| `0.1.0-rc4` | `1.0.0-pre.0` | `1.0.0-pre.0` | `acc-s3r1.1` | `acc-s3r1.1` | `0.20.0` | midnight-js `5.0.0-rc.2`, ledger-v9 `1.0.0-rc.5` |
| `0.1.0-rc5` | `1.0.0-pre.0` | `1.0.0-pre.0` | `acc-s3r1.1` | `acc-s3r1.1` | `0.20.0` | midnight-js `5.0.0-rc.2`, ledger-v9 `1.0.0-rc.5` |

RC1 had eight implementations and five empty scaffolds. RC4 and RC5 contain nine
implemented packages, adding the service library and excluding the scaffolds.
The RC5 row describes this preview release's binding and wire compatibility;
it does not establish full Lace runtime compatibility or complete support for
all pinned ACC circuits. See the [RC5 release notes](site/release-notes-rc5.md).


### Hosted signer runtime findings (2026-10-17)

The [consumer report](lace-consumer-report.md#runtime-findings-and-acceptance-still-open)
records actual Lace protocol tests: creation and non-rotating enrollment do not admit the
SDK's inbox validation/roster requests, and sign-in intentionally hides device registrations.
An empty inbox batch is a transport no-op; SDK P-256 and JubJub opening now request a real
entry before accepting the viewing key. Both packed-consumer checks reject separate physical
copies of the current Compact/ledger modules, even when their versions match. These checks
improve integration diagnostics; #79/#81's cross-product runtime criteria remain open.

## Stability foundation clarification — 2026/10/20

| Capability | Retained binding support | Evidence boundary |
| --- | --- | --- |
| JubJub and P-256 entry removal | One selected opaque entry, with complete/unique SDK roster and fresh viewing/roster delivery checks | Generated-circuit regressions and port/crypto tests; not complete compromised-key revocation |
| Previous viewing knowledge | Cannot be erased by rotation/removal | Old envelope/registration openings remain possible with the old key context |
| Total-loss recovery | Not exposed; legacy finaliser is not a safe full-retirement fallback | Exact source and separately compiled candidate simulator comparison; no candidate proof/node/key adoption |
| Imported-account recovery setup | Unknown from the reference-service constructor policy | Address, schema tags, epoch/count are insufficient to infer the secret lifecycle or installed verifier code |
| Qualification harness | Foundation source/simulator/port tiers implemented with closed receipts | Missing/skipped/unimplemented cases do not pass; no full release/current-Lace claim |

See [ADR 0012](adr/0012-retain-binding-with-explicit-removal-and-recovery-limits.md)
and the [qualification guide](site/qualification.md). No binding ID, generated artifact
or key manifest was repointed. The exact-value shielded withdrawal guard remains.

## 2026/10/24 foundation review correction

Unanchored earlier envelopes cannot authenticate removal targets; the history port
is removed. The retained-target-metadata experiment was withdrawn because another
rotation could reinclude that still-live reader. Legacy retry/interleaved rotations
refuse an unresolved current roster; original protected continuations need the dependent durability API and an unchanged ledger frontier; the foundation itself does not supply them. Anonymous earlier envelopes cannot evict genuine older holding keys or force a separate sixteen-key lockout.
Runtime identities reject symlinked package/dist directories and hash compiled inputs.
Outer receipt repetition does not certify external consumer-input equivalence.

### Historical candidate correction — 2026/10/24

The global sixteen-key truncation/refusal is withdrawn: anonymous earlier envelopes
must neither evict a genuine old coin key nor lock sign-in. All distinct earlier
secrets within the existing 4096-envelope bound remain decryption candidates, and
are zeroed after use. Only the ledger-matching current secret/roster authenticates
metadata; earlier candidates never identify device-removal targets. The regression
places a real older coin behind seventeen forged envelopes and verifies metadata,
coin reads, device delivery and new key creation remain usable. Large-inbox work
still scales with candidate keys and coin entries; the existing 4096 limits and
operator/resource qualification remain explicit. No unbounded-input guarantee.

## 2026/10/23 host durability correction

Unknown lookup and wave-frontier polls retain no new full journal revisions.
Cancellation propagates through correlated host calls and reconciliation. A successful
dispatch CAS commits that one send; cancellation stops later waves. Failed explicit
resume retains cancellation. Native prepared bytes need ten seconds remaining and are
never renewed. Direct/reconciled deployment receipts share their validation rules.


### Combined source acceptance — 2026/10/24

Frozen source `06dbdc6` passed one both-arm combined grant/holding/prover/indexer
round: 16 case entries, 34 host-confirmed transactions, no duplicate host sends.
Each arm retained a seven-unit shielded test holding and an independently readable
active grant through rotation restart. Offline owner 200 / populated 260 / host 152 cases
retain their distinct scope and exact source/runtime hashes; see
[verification](review/combined-outages/verification.json). Owner pre-registration
proof loss safely refuses explicit resume rather than assuming no send. No real
provider, live enrollment/removal, full release/Lace or large-inbox resource acceptance
is implied; broad #230/#231/#232/#239 remain open.

### Grant bookkeeping after profile loss — source slice 2026/10/26

Both generated-contract signature arms now have a shared qualification case for
separate empty profiles, original-reader reconstruction, independent enrolled-reader
refusal, absent/wrong opening providers and selective/all read revocation. Ordinary
JubJub create/directory open also persists the verified local record needed by grant
APIs. Native scope now has five completed JubJub entries at `4a45aa0` (its later
overall run failed, with a separate completed-arm end audit) and a five-entry
P-256 single-arm PASS at `7483786`. The recorded component comparison preserves
identical SDK/native worker/shared assertions, compiled runtime and reference
inputs; there is no same-source both-arm CLI PASS. Across scopes: 44 confirmed
host transactions, no duplicate host sends and 34 direct native owner calls,
excluding setup transactions. Both retain two grants through rotation and the
seven-unit holding through selective/all revoke. See [review map](review/grant-recovery/README.md)
and [verification](review/grant-recovery/verification.json) for exact hashes/limits.

Reconstruction returns bookkeeping only. It does not recreate full staged scope,
private grantee keys, incomplete publication or total identity loss. An inactive
tombstone yields `GrantRevoked`; absent individual commitments after revoke-all
remain `GrantBookkeepingUnsettled`. Missing openings retain active IDs and refuse
preserving rotation. Native grant interruption and automatic grantee seal discovery
are not qualified by this case. No published RC5 or full Lace claim is widened.

### Survivor/reconnect qualification scope — 2026/10/25

The local source adds an opt-in `survivor-reconnect` suite: three independent
software identities in both arms, enrollment/removal post-submit continuation with
active grants/holdings, survivor authorization and removed-reader current-key
refusal, then an actual built-in wallet indexer disconnect and fresh incoming
NIGHT balance. Its [review map](review/survivor-reconnect/README.md) records evidence
status. The wallet test runs in Node, uses the same preserved synthetic HD seed
and a direct standalone transfer; it does not qualify an ACC withdrawal, a browser
provider, seed-loss recovery or full Lace compatibility. Removal spans transactions
and does not retire a concurrent compromised signer atomically. No published
package/image, binding pin, key manifest or exact-value guard changes in this slice.

The signed `094c7f0` source completed this declared local scope: 21 case entries,
88 confirmed host transactions, zero duplicate sends, four host deaths/four account
indexer probes, plus the separate fresh-credit wallet outage/recreation case. See
[verification](review/survivor-reconnect/verification.json). Executable inputs are
unchanged by later documentation-only forward changes. Broad issues remain open.


### Current preparation and outage follow-up — 2026/10/26

The source adds memory/encrypted-file held-successor call-preparation races and
real-loopback HTTP conflict, persistent refusal, simulated expiry, cancellation
and client-timeout tests. No automatic replacement or uncertain rebroadcast is
introduced. The new explicit `survivor-outages` profile combines deployment/prover,
activation, populated enrollment/removal and survivor rotation/indexer boundaries.
Signed source `5d2bf2062fab64a40eadee009823e7a69bd70cc6` passed one both-arm software/localnet round:
32 entries, 88 confirmed host transactions, zero duplicate host sends, ten
indexer-down probes and four prover stops. Original IDs/plans/bytes survived;
pre-registration owner proof failure remained safely unresolved with unchanged
host records/send count. The first failed harness expectation and its uncertain
intent are retained. This adds no real-provider/two-browser, full Lace or
three-consecutive-run release acceptance. Those broader gates remain open. See
[review map](review/preparation-outages/README.md).
