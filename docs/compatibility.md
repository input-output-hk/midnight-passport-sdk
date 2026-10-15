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

The local demo service is not a published SDK package. The service API constant
names the versioned client wire types; the demo still uses its prototype routes.

## Lace consumer seam check

The fixture in `tests/fixtures/lace-seams.mjs` tracks
[lace-platform PR #2845](https://github.com/input-output-hk/lace-platform/pull/2845)
at head `05e1e3d641a329d20c8272f6405e54ea499d86a1` (2026/10/15), from
`packages/contract/passport/src/types.ts`. `tests/account-ports.test.mjs` checks
the structural TypeScript assignments. This is a seam check against the PR's
types, not a packed-package Lace build or live transaction test.

| Lace seam | SDK port | Current result |
| --- | --- | --- |
| `FeeSponsor.balanceAndSign` | `FeeSponsor` | Direct structural assignment |
| `PassportEncryptionKey` | `AccountViewingKey` | Direct structural assignment for reader, keyring, inbox, and grant operations |
| `readGrants` plus stored grant openings | `ActiveReadGrantTargetSource` | `createMidnightGrantSource` reads the complete pinned ACC roster at one auth nonce and verifies each available read key against the on-chain hash; Lace still supplies its durable opening store and a same-network provider |
| `readGrants` active IDs for issue | `ActiveGrantSnapshotSource` | The same adapter returns IDs and auth nonce from one ledger snapshot; the SDK checks them against its signing view and rechecks before staging. Lace still owns the consent and durable grant journal. |
| `PassportNetworkConfig` | `NetworkConfig` | Lace network fields fit; the SDK caller must supply its additional ACC binding and manifest pins |
| `PassportAuthoriser` | `Authoriser` | The SDK now sends Lace's required account, grant scope/salt/slot/digest, device commitment, and creation lock context to key sessions. A boundary adapter is still needed for branded account/counter/epoch values and the hosted signer's request encoding; no packed Lace flow has been proven yet. |
| `PassportProver.prove/check` | transaction `Prover.proveTx` | Different abstraction: Lace proves a circuit preimage; a transaction pipeline must wrap it |

The current Lace `KeySessionFlow.kind` omits `rotate-encryption-key`, which the
SDK's owner flow requests. The test adapter rejects this operation until Lace and
the SDK agree on its consent descriptor. The SDK's JubJub rotation now prepares
read-grant seals before switching the ACC key, but Lace must supply a chain-backed
grant target adapter with the exact auth nonce and its own consent path. The SDK's
JubJub account read uses Lace's `read-holdings` descriptor and a host-injected
chain-backed holding source. Neither flow has run in Lace's module, so neither
is yet a verified Lace flow replacement. Full read-grant issue/revoke composition remains.

The older SDK `EncryptionKeySource.publicKey` port is a prototype key source;
Lace's `PassportEncryptionKey` matches the newer `AccountViewingKey` instead.
The release preflight now installs the packed SDK tarballs in a scratch host,
compiles these Lace-shaped seams against the installed account-port types,
loads the entry points, and builds a browser bundle. This checks packaging and
type resolution, but uses a copied seam fixture rather than Lace's own build.
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
