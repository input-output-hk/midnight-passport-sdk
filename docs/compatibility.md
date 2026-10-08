# Compatibility matrix

> **Status:** live · started 2026/07/29 (first external Midnight dependency) ·
> updated 2026/10/08
> Maintained by `mn-passport-skills:deps` (development-workflow §2): the two
> version axes of architecture §4.6 — **wire** (`mn-passport-protocol` ↔
> dApp connectors) and **binding** (`mn-passport-contract` ↔ deployed ACC)
> — plus the toolchain each binding was produced with. A row changes only
> through a reviewed PR. From 2026/10/08 the wire axis is the **API axis**
> and releases are lockstep (see [Axes and releases](#axes-and-releases)).

## Binding axis

| SDK | ACC binding | Compact CLI | Compiler | Language | Runtime (`@midnight-ntwrk/compact-runtime`) | Status |
|---|---|---|---|---|---|---|
| dev (unreleased) | `0.0.0-prototype.1` `[PROVISIONAL]` | 0.5.1 | 0.31.1 | 0.23.0 | **0.16.0** (root devDependency, exact pin) | prototype — re-pinned when [passport#116](https://github.com/midnightntwrk/passport/issues/116) delivers publisher versioning |

The runtime column must equal the binding's recorded
`toolchain.runtimeVersion` (`packages/contract/acc-versions.generated.json`)
— a test asserts the agreement (`tests/contract-deploy.test.mjs`). If two
supported bindings ever require different runtime majors, that is a
compatibility event this matrix must resolve before the second binding is
adopted (spec D-8). From the first published release, all bindings in one
release share one Compact runtime (FS-0.9 D-6), so that event is resolved by
retiring a binding in the release that moves the runtime.

## Wire axis

| SDK | `PROTOCOL_VERSION` | Status |
|---|---|---|
| dev (unreleased) | — | lands with the M2 wire types (FS-0.1 D-4) |

## Axes and releases

Added 2026/10/08 ([ADR 0006](./adr/0006-publish-on-github-packages.md),
[ADR 0007](./adr/0007-package-set-ports-and-flows.md); publishing design
[§3.5 and §6.5](./superpowers/specs/2026-10-07-passport-sdk-packages-design.md)).
The wire axis above becomes the API axis when the account API lands (tranche
T1); `PROTOCOL_VERSION` is replaced by the two constants below.

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
| dev (unreleased) | — | — | — | — | — | — |

The dev row fills as tranches land: the versions with T1, the bindings and the
runtime with FS-0.9 (T10 to T13). The first published release adds the first
real row.
