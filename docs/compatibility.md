# Compatibility matrix

> **Status:** live · updated 2026/10/15. Releases are lockstep across the
> `@input-output-hk/mn-passport-*` packages. The binding data is pinned in
> `packages/contract/acc-binding-v2.generated.json` and the generated registry.

## Binding axis

| SDK | ACC binding | Passport source | Compiler | Language | Runtime (`@midnight-ntwrk/compact-runtime`) | Compiler manifest SHA-256 |
| --- | --- | --- | --- | --- | --- | --- |
| `0.1.0-rc1` | `acc-s3r1.1` | `6458ed5` (P-256 plus caller-pinned grants) | 0.35.0 | 0.27.0 | 0.20.0 | `77fb9c17b0d59047456c43115d9a58f5cb99a226ee73b6b974fd724930c3153f` |

The package registry supports only `acc-s3r1.1`. The older provisional
`0.0.0-prototype.1` binding is retired. The separate `acc-45721e1` key bundle
remains in `mn-passport-contract` for prototype archive work, but the SDK does
not deploy or resolve it. All supported bindings in this release use the same
Compact runtime.

## API axis

| SDK | Account API (`PASSPORT_API_VERSION`) | Service API (`PASSPORT_SERVICE_API_VERSION`) |
| --- | --- | --- |
| `0.1.0-rc1` | `1.0.0-pre.0` | `1.0.0-pre.0` |

The local demo service was not a published SDK package in RC1. The service API
constant names the versioned client wire types; the current prototype browser
uses the `/v1` config, deployment, proving, sponsorship and directory routes.

On 2026/10/15 the prototype browser created a JubJub account against the pinned
`acc-s3r1.1` binding on an isolated localnet, activated its first device, then
reopened the same account after a page reload with the development mock passkey.
The reference ACC `test:auth-coinless` also passed with both enrolment directions
and an on-node JubJub-authorized gated call. This validates the local SDK
composition; it does not establish interoperability inside Lace's hosted module.

## Lace consumer seam check

The SDK keyring accepts Lace's JubJub device registration type `0xd2` and adds
type `0xd5` for a compressed 33-byte P-256 authoriser key and its WebAuthn
policy under a distinct encryption domain. The earlier `0xd4` key-only record
can still open, but lacks the policy needed to resolve another live P-256
device. The browser's P-256 create/open flow uses a random,
sealed viewing secret and publishes its entries on chain. Lace PR #2845 reads
only the JubJub registration. The P-256 record is therefore an SDK extension,
not evidence of Lace runtime compatibility. P-256 rotation and recovery with a
second device remain open.

The fixture in `tests/fixtures/lace-seams.mjs` tracks
[lace-platform PR #2845](https://github.com/input-output-hk/lace-platform/pull/2845)
at head `05e1e3d641a329d20c8272f6405e54ea499d86a1` (2026/10/15), from
`packages/contract/passport/src/types.ts`. `tests/account-ports.test.mjs` checks
the structural TypeScript assignments. A second local check now compiles the
**actual contract seam sources** from that exact Lace commit against all nine
packed SDK tarballs. It checks the tarball SHA-256 values in the release
manifest, then compiles Lace's `PassportAuthoriser`, `PassportEncryptionKey`,
`FeeSponsor`, `PassportProver`, network config, grant scope and bookkeeping
types with `tests/fixtures/lace-source-consumer.ts`. To reproduce with an exact
Lace PR checkout and a fresh `release-tarballs/` pack:

```sh
LACE_CHECKOUT=/path/to/lace-platform \
  RELEASE_VERSION=0.1.0-dev.1 \
  nix develop -c node scripts/smoke-lace-source-consumer.mjs
```

Lace PR #2845 has since advanced to `cdfa9cfd81a0adcc0a7224aa624f18e52494f602`.
Its newer grant flow validates stored openings against the live ACC object commitment and
read-key hash before reusing them. The SDK's chain-backed grant adapter now exposes those
commitments through `GrantCommitmentSource`; publication must enforce the match before the
newer Lace head can be considered compatible. The exact-source test above remains pinned to
the earlier head until that check is updated and rerun.

The check pins Lace HEAD to `05e1e3d641a329d20c8272f6405e54ea499d86a1`
and rejects local edits to its contract seam. The Lace source dependencies
`type-fest@4.41.0` and `ts-custom-error@3.3.1` match its lockfile. The result
is a source-level compile check, not a build of Lace's module or a live
transaction. It establishes direct structural compatibility for the sponsor,
viewing key, grant scope and bookkeeping. The browser package now exports
`./hosted-jubjub` with `hostedJubjubAuthoriser`: it converts tagged account/epoch/counter inputs,
compresses and validates the device key, and carries the signing request to
Lace's hosted signer without forwarding the SDK-only challenge. The host
supplies Lace's tagged constructors and a consent-flow converter. The adapter
rejects absent key sessions, non-JubJub circuits, unsupported rotation, and
any converter output that changes a consent field. The exact-source fixture
compiles that adapter with Lace's current `PassportAuthoriser`. The
circuit-level prover still needs a transaction pipeline adapter. Network
config additionally needs the ACC binding and manifest pins.

On 2026/10/15, SDK commit `8905dbcb29d48959075768c34a85682ab8ccd6be`
was packed locally as nine `0.1.0-dev.2` tarballs. The exact Lace source check
above passed against those tarballs. The release consumer smoke also loaded all
nine entry points, compiled the Lace-shaped host fixture, built a scratch Vite
browser app, and restored and hash-verified the pinned `deposit_unshielded`
key. This `dev.2` pack was local validation, not a registry release.

On 2026/10/15, SDK commit `9e31aeeaeb90f9f355162e368a90c6fce4238bd8`
was packed locally as nine `0.1.0-dev.3` tarballs. The release consumer smoke
loaded the packages, compiled the Lace-shaped host fixture, built a browser
bundle, and hash-verified a restored `deposit_unshielded` key. The exact Lace
source check passed against PR #2845 at the pinned head above. These are
local checks, not a registry release or a Lace module runtime test. TypeScript
accepts direct structural assignment of Lace's authoriser; the hosted adapter
still handles runtime branding and rejects unsupported consent descriptors.

The scratch browser build emitted ledger v8 and v9 WASM assets. Dependency
inspection found one `@midnightntwrk/ledger-v8@8.1.2` and one
`@midnightntwrk/ledger-v9@1.0.0-rc.5` in the SDK adapter path: upstream
`midnight-js-protocol@5.0.0-rc.2` supports both ledger generations. These are
two different protocol runtimes, not duplicate copies of one version. Lace's
own module bundle and hosted transaction path remain to be measured.

| Lace seam | SDK port | Current result |
| --- | --- | --- |
| `FeeSponsor.balanceAndSign` | `FeeSponsor` | Direct structural assignment |
| `PassportEncryptionKey` | `AccountViewingKey` | Direct structural assignment for reader, keyring, inbox, and grant operations |
| `readGrants` plus stored grant openings | `ActiveReadGrantTargetSource` | `createMidnightGrantSource` reads the complete pinned ACC roster at one auth nonce and verifies each available read key against the on-chain hash; Lace still supplies its durable opening store and a same-network provider |
| `readGrants` active IDs for issue | `ActiveGrantSnapshotSource` | The same adapter returns IDs and auth nonce from one ledger snapshot; the SDK checks them against its signing view and rechecks before staging. Lace still owns the consent and durable grant journal. |
| `PassportNetworkConfig` | `NetworkConfig` | Lace network fields fit; the SDK caller must supply its additional ACC binding and manifest pins |
| `PassportAuthoriser` | `Authoriser` | `hostedJubjubAuthoriser` supplies the boundary for branded account/counter/epoch values and request encoding. The host supplies tagged constructors and a lossless consent converter. Its packed type check and focused runtime tests pass; no Lace-hosted transaction has been proven yet. |
| `PassportProver.prove/check` | transaction `Prover.proveTx` | Different abstraction: Lace proves a circuit preimage; a transaction pipeline must wrap it |

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

The release row records the RC1 package API and pinned grants binding. The
service library and JubJub authoriser were not part of RC1; development toward
the next release is tracked separately from this published release row.
