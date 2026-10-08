# 0006 — Publish the SDK packages on GitHub Packages, from a fork-only workflow

Date: 2026/10/08 · Status: accepted · Settles: FS-0.9 D-10 · Amends: the registry rule in `CLAUDE.md`
Refs: [input-output-hk/midnight-passport-sdk#31](https://github.com/input-output-hk/midnight-passport-sdk/issues/31)
(SDK publishing migration, tracking) · design:
[`2026-10-07-passport-sdk-packages-design.md`](../superpowers/specs/2026-10-07-passport-sdk-packages-design.md)
D-1, §6

## Context

The packages are named `@midnight-ntwrk/mn-passport-*`, are `private`, and have
never been published. `CLAUDE.md` says "no custom registry config
(`@midnight-ntwrk/*` are on public npm)", and FS-0.9 §2 leaves publishing to
npmjs or under `@midnight-ntwrk` to the upstream owners. FS-0.9 D-10 proposed
the other route, GitHub Packages under the owning account's scope, and left
the publisher question open.

Three facts shape the choice:

- **GitHub Packages scopes a package name to its owner.** For this fork the
  scope is `@input-output-hk`. lace-platform, the first production consumer,
  already publishes `@input-output-hk/lace-sdk` to this registry, so its CI
  has the install pattern.
- **Its npm registry requires a token to install, even a public package.**
  Consumers need an authenticated scope line.
- **It caps a version at 256 MB.** Fifteen prover keys of the 52-circuit ACC
  build exceed that on their own, so prover keys cannot travel in an npm
  package (FS-0.9 D-4).

The prototype branch suspended two supply-chain controls on purpose: the
7-day dependency cooldown (`min-release-age = 0` in `.npmrc`,
`minimumReleaseAge: 0` in `pnpm-workspace.yaml`, owner decision 2026/10/06) and
the pull-request checks (`.github/workflows/pr-checks.yml`, owner decision
2026/10/07). Both files say to restore them before anything leaves the
prototype branch. Publishing is what makes something leave it.

On 2026/10/08 the owner directed publishing on GitHub Packages and approved
starting the tranches. Every other decision below is the design's
recommendation, taken as the working baseline.

## Decision

- **Publish the client packages as `@input-output-hk/mn-passport-<name>` on
  GitHub Packages** (`https://npm.pkg.github.com`), from a manual workflow
  that exists only in this fork. The package set is ADR 0007's. Directory names
  under `packages/` do not change. The workspace names stay
  `@midnight-ntwrk/mn-passport-*` until the mechanical rename in tranche T23.
- **The workflow is fork-only and manual.** `.github/workflows/publish.yml` is
  committed with the `fork-only:` subject prefix, runs on `workflow_dispatch`
  only (inputs: the dist-tag `dev`, `next` or `latest`, and a dry run), and its
  job runs only when `github.repository` is
  `input-output-hk/midnight-passport-sdk`. Permissions are `contents: read`,
  `packages: write`, `id-token: write` and `attestations: write`. It lints,
  checks format, builds and runs the tests before it packs, attests and
  publishes. Actions are pinned by SHA.
- **Lockstep versions.** Every package shares one version. Before 1.0 the
  releases are `0.y.z`: a minor may break, a patch may only add. 1.0.0 is cut
  when lace-platform integrates. The `dev` tag stamps `0.y.z-dev.<run>`.
  Compatibility is one row per release (`docs/compatibility.md`).
- **One scoped registry line.** `@input-output-hk:registry=https://npm.pkg.github.com`,
  for publishing this fork's packages and for installing them. Every other
  scope, `@midnight-ntwrk/*` included, resolves from public npm. No token is
  ever committed. This replaces the "no custom registry config" rule in
  `CLAUDE.md`, and its echoes in `docs/development-workflow.md` §2 and the
  `deps` skill.
- **Consumers need a `read:packages` token.** A developer uses a personal access
  token (classic) with `read:packages`, supplied from the environment
  (`//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}`), never from a committed
  file. In GitHub Actions the workflow's `GITHUB_TOKEN` works once each
  package's settings grant the consuming repository read access.
- **Attestations.** The workflow attests each packed tarball with GitHub's
  artifact attestations. A consumer checks one with
  `gh attestation verify <tarball> -R input-output-hk/midnight-passport-sdk`.
  npm's `--provenance` records a Sigstore statement on the public npm registry
  only; whether GitHub Packages also shows npm provenance is checked when the
  workflow is built.
- **The cooldown and CI are restored before the first publish.** Tranche T24
  restores `min-release-age = 7` and `minimumReleaseAge: 10080`, and the
  suspended pull-request checks, first, and only then adds the publish
  workflow.
- **Prover keys stay out of npm.** One content-addressed bundle per binding,
  verified by the artefact manifest, or rebuilt from ZKIR by the prover
  (FS-0.9 D-4).
- **This settles FS-0.9 D-10, the publisher question.** The fork publishes. It
  does not decide publication to npmjs or under `@midnight-ntwrk`, which stays
  the upstream owners' decision (FS-0.9 §2). The rename is mechanical, so
  nothing here forecloses it.

## Consequences

- `CLAUDE.md` carries the new registry rule, and says the fork publishes
  `@input-output-hk/mn-passport-*` while the workspace names wait for T23.
  `docs/development-workflow.md` §2 and the `deps` skill's hygiene rule are
  corrected in the same change.
- The `deps` skill's cooldown check must learn the second registry, so that it
  can read publish dates for `@input-output-hk/*` packages. That lands with
  the publish workflow (T24).
- `docs/compatibility.md` gains the two version axes and the lockstep release
  rule.
- A consumer without a GitHub account cannot install the packages. That is
  accepted for a fork-hosted, pre-1.0 line; a public npm release would lift it
  and is not decided here.
- Nothing is published by the docs tranche (T0). Wave 6 (rename and publish)
  may move ahead of waves 4 and 5, because the client side is complete after
  wave 3 (design §8).
- Packages need `private: false`, a `publishConfig`, a `repository` with its
  `directory`, an `exports` map and `files`, with a packed-tarball exports
  check and a static-Midnight-import scan before each publish (design §6.1).

## Revisit

Questions from design §9 that bear on publishing and stay open; the rest are
listed in [ADR 0007](./0007-package-set-ports-and-flows.md).

- **Q6.** One Midnight package set with lace-platform: Lace moves to the SDK's
  set, or the SDK supports Lace's older set for a while, and who decides the
  set per release.
- **Q12.** Where the per-binding prover-key bundle lives, and whether the
  service rebuilds the keys from ZKIR at start (FS-0.9 OQ-6).
