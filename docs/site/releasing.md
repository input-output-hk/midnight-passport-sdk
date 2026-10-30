---
layout: default
title: Releasing packages
permalink: /releasing/
---

## RC6 release in progress

The next preview is `0.1.0-rc6`, with the same nine private npm packages and
three public Linux/amd64 images. [RC6 notes]({{ '/release-notes-rc6/' | relative_url }})
state the candidate scope and limitations. RC5 digests below remain historical
pins until the verified RC6 publication receipt is available. Source and private
publisher package checks include eight installed-package TTL-zero process cases;
expiry must never strand a confirmed receipt. Release tests retain independent
proof, actual-host, synthetic and manual-provider evidence classes.

The `0.1.0-rc5` preview packs nine implemented packages, including the Node `service` HTTP core, for the **private** GitHub Packages npm registry under `@input-output-hk/mn-passport-*`. It uses the `next` distribution tag. [RC5 release notes]({{ '/release-notes-rc5/' | relative_url }}) list supported flows and limits. The older `0.1.0-rc1` release has 13 private package records: eight implementations and five empty scaffolds. Those scaffolds remain private workspace packages and are excluded from RC5.

The source repository's [release-check workflow](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/.github/workflows/publish.yml) builds, tests, packs, smoke tests, and attests a signed release tag. The [exact-source Lace consumer check](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/compatibility.md#lace-consumer-seam-check) checks the pinned PR source against local tarballs; it is a type-level seam check, not a claim of Lace runtime interoperability. The [private publisher](https://github.com/input-output-hk/midnight-passport-sdk-publisher) checks for a passing release every 15 minutes, verifies the signed source tag and commit, then independently runs the build and packaging checks. Its clean consumer test imports the account and browser entrypoints, builds a scratch Vite app using the packaged grants binding, and restores a circuit from the packaged ZKIR. The pack manifest records each tarball's SHA-256 digest; the private publisher checks it before publishing and verifies the release version and **private** visibility after each package. The workflow can resume after a partial run. It uses only the private repository's `GITHUB_TOKEN` and publishes only to GitHub Packages.

In RC5, the packer excludes `dist/.tsbuildinfo` from all nine tarballs and refuses
any build-cache entry that slips through. The source workflow also builds and packs the tracked
source twice in distinct temporary directories, then compares every tarball SHA-256 value.
Locally, run `nix develop -c node scripts/check-release-reproducibility.mjs` after staging the
source to repeat that check. The private publisher must still compare the exact registry bytes
against its signed attestation; a matching local build alone does not verify a published package.

A signed `sdk-check-v<semver>` tag pointing to `passport-acc-prototype` history runs a dry run in the source repository. To publish, push a GPG-signed annotated `sdk-v<semver>` tag pointing to a signed, DCO-signed commit in that branch's history. Once the source release check passes, the private publisher picks it up automatically. Its [workflow](https://github.com/input-output-hk/midnight-passport-sdk-publisher/actions/workflows/publish.yml) can also be started manually with the tag to avoid waiting for the next scheduled run.

Push release tags **one at a time**. GitHub does not create push events when more than three tags
are pushed together; a four-tag SDK/image push can therefore publish nothing. See the official
[push event limit](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#push).
Verify each workflow started before considering publication underway.

Consumers add a scoped registry rule and supply a token outside source control:

```ini
@input-output-hk:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

GitHub Packages requires authentication to install these packages. A local consumer uses a classic token with `read:packages`; a consuming GitHub Actions repository needs package read access for its `GITHUB_TOKEN`. Package administrators can grant teams and repositories access in GitHub. No token belongs in a committed `.npmrc`.

The first live publish from the public source repository created public package records, which were deleted. A restricted personal-token probe created an internal package and was also deleted. All current RC1 package records were created by the private publisher and checked through the Packages API for private visibility. This is why the source repository retains its live-release guard.

The [packaging tracker](https://github.com/input-output-hk/midnight-passport-sdk/issues/31) is the release checklist.

## Historical RC5 artefacts and verification

The [RC5 release](https://github.com/input-output-hk/midnight-passport-sdk/releases/tag/sdk-v0.1.0-rc5)
and [publication receipt](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/release/rc5-publication-receipt.json)
record the published package hashes, exact signed source and workflow runs. All nine npm packages
remain private. The three GHCR packages retain their existing public visibility; their runtime
platform is Linux/amd64, UID/GID `10001:10001`.

| Image (`ghcr.io/input-output-hk/`) | Version | Immutable digest |
| --- | --- | --- |
| `midnight-passport-keys` | `0.1.0-rc5` | `sha256:fc5de57ff6e28a0ceecff5ff13d1c8c960559e3d40630d6f438c7ee665575bd6` |
| `midnight-passport-service` | `0.1.0-rc5` | `sha256:b4d2900689c37fd7f8fee9dfa1257a45da9a41efd3e7841f4e5496605ccb6b25` |
| `midnight-passport-funding` | `0.1.0-rc5` | `sha256:94f387509d5de572c3c94be6fd7412c103323bf3c499ee597e44799a50689eb2` |

Deploy as `ghcr.io/input-output-hk/<image>@<digest>`. Image IDs from local builds do not
substitute for registry manifest digests. The receipt covers pulled-image startup, mounted-tree
localnet deposit/replay, key serving and fresh single-circuit regeneration. Linux-prepared ACC
mounts and durable writable state are still required by the service and funding images.

For each future release, verify actual registry bytes against the private publisher's signed
attestation and check SRI, package access/visibility and exact dist tags. RC5's local macOS and
Linux publisher archives have identical decompressed tar streams; only gzip's OS header differs
(`19` versus `3`). SHA-256 values in the publication receipt refer to the exact registry bytes.
Do not replace those hashes with a locally repacked archive's hash or skip attestation verification.

Run a clean consumer against downloaded registry tarballs, pull images by digest and perform
network checks before updating the current release banner. Preserve the shielded exact-value
guard and documented Lace limitations until their separate acceptance criteria pass.

After installing with the scoped registry configuration, download a package's exact tarball with
`npm pack @input-output-hk/mn-passport-contract@0.1.0-rc5` in a scratch directory. Compare its
SHA-256 against the signed release manifest and verify its source attestation:

```sh
shasum -a 256 input-output-hk-mn-passport-contract-0.1.0-rc5.tgz
gh attestation verify input-output-hk-mn-passport-contract-0.1.0-rc5.tgz \
  --repo input-output-hk/midnight-passport-sdk \
  --signer-workflow input-output-hk/midnight-passport-sdk/.github/workflows/publish.yml \
  --source-digest 9e8048674a54adf5e8be2055aaa8f5c9bfe08b06
```

The release's `SHA256SUMS` and publication receipt have detached GPG signatures. Verify those
signatures with the release signer's independently trusted public key; a checksum alone does
not establish who supplied it. Publisher-workflow attestations are additionally available to
callers with access to `input-output-hk/midnight-passport-sdk-publisher`.

## Image workflows and earlier releases

The key image publishes from `keys-v<version>`, the proving/sponsorship service from
`service-v<version>`, and the funding service from `funding-v<version>`. Each signed tag at the
reviewed source triggers its own workflow and publishes a version alias and source-SHA alias.
Verify their registry digests agree. Push the tags separately as described above.

RC2 and RC3 image records are historical and superseded by the current RC5 digests above.
Their [earlier qualification record](https://github.com/input-output-hk/midnight-passport-sdk/blob/9e8048674a54adf5e8be2055aaa8f5c9bfe08b06/docs/site/releasing.md)
remains available for audits. Use the [service](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-service/README.md),
[funding](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-funding-service/README.md)
and [key](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-key-service/README.md)
image guides for RC5 mount, wallet and network requirements.
