---
layout: default
title: Releasing packages
permalink: /releasing/
---

The `0.1.0-rc4` preview packs nine implemented packages, including the Node `service` HTTP core, for the **private** GitHub Packages npm registry under `@input-output-hk/mn-passport-*`. It uses the `next` distribution tag. [RC4 release notes]({{ '/release-notes-rc4/' | relative_url }}) list supported flows and limits. The older `0.1.0-rc1` release has 13 private package records: eight implementations and five empty scaffolds. Those scaffolds remain private workspace packages and are excluded from RC4.

The source repository's [release-check workflow](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/.github/workflows/publish.yml) builds, tests, packs, smoke tests, and attests a signed release tag. The [exact-source Lace consumer check](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/compatibility.md#lace-consumer-seam-check) checks the pinned PR source against local tarballs; it is a type-level seam check, not a claim of Lace runtime interoperability. The [private publisher](https://github.com/input-output-hk/midnight-passport-sdk-publisher) checks for a passing release every 15 minutes, verifies the signed source tag and commit, then independently runs the build and packaging checks. Its clean consumer test imports the account and browser entrypoints, builds a scratch Vite app using the packaged grants binding, and restores a circuit from the packaged ZKIR. The pack manifest records each tarball's SHA-256 digest; the private publisher checks it before publishing and verifies the release version and **private** visibility after each package. The workflow can resume after a partial run. It uses only the private repository's `GITHUB_TOKEN` and publishes only to GitHub Packages.

For the next release, the packer excludes `dist/.tsbuildinfo` from all nine tarballs and refuses
any build-cache entry that slips through. The source workflow also builds and packs the tracked
source twice in distinct temporary directories, then compares every tarball SHA-256 value.
Locally, run `nix develop -c node scripts/check-release-reproducibility.mjs` after staging the
source to repeat that check. The private publisher must still compare the exact registry bytes
against its signed attestation; a matching local build alone does not verify a published package.

A signed `sdk-check-v<semver>` tag pointing to `passport-acc-prototype` history runs a dry run in the source repository. To publish, push a GPG-signed annotated `sdk-v<semver>` tag pointing to a signed, DCO-signed commit in that branch's history. Once the source release check passes, the private publisher picks it up automatically. Its [workflow](https://github.com/input-output-hk/midnight-passport-sdk-publisher/actions/workflows/publish.yml) can also be started manually with the tag to avoid waiting for the next scheduled run.

Container images use separate signed tags and workflows. The [key image](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-key-service/README.md) is published as `ghcr.io/input-output-hk/midnight-passport-keys:<version>` from `keys-v<version>`. The [funding image](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-funding-service/README.md) was published as `ghcr.io/input-output-hk/midnight-passport-funding:0.1.0-rc2` from the verified signed `funding-v0.1.0-rc2` tag after its local Linux build, mounted-tree startup, real non-native deposit, and release workflow passed. Its digest is `sha256:5b1aebaba4944c0beccd8d70047b51b9d779f30a8839461af20c5a10f26ca9e5`; use that digest in deployments. The funding image needs a Linux-prepared pinned ACC tree, a separate wallet seed outside localnet, private token and asset policy files, and persistent reservation/wallet state. The funding GHCR package is currently public; visibility and consumer access can be changed in its package settings.

The [proving and sponsorship service image](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-service/README.md) was published as `ghcr.io/input-output-hk/midnight-passport-service:0.1.0-rc2` by its [signed-tag workflow](https://github.com/input-output-hk/midnight-passport-sdk/actions/runs/38675830505). The version and `sha-965a822d98ed` tags share digest `sha256:f66431befe3c226a8689ef4f624b854dfeaef9f545bd861a15714cea26bc9cd1`. It requires a Linux-prepared pinned ACC export mounted read-only, a persistent registry and wallet state volume, and a dedicated sponsor seed file outside localnet. Its startup smoke test checks missing-export, missing-seed, and wrong-manifest refusal. A network-backed mounted-tree run and immutable digest must be recorded before treating a new tag as release evidence. The service has no built-in caller authentication; deploy it behind a controlled ingress.
RC2's `/v1/config` advertises the service's own network URLs, which can be Docker-only hostnames;
browser clients need the separate public URL configuration introduced in RC3.

The corrected [RC3 service image workflow](https://github.com/input-output-hk/midnight-passport-sdk/actions/runs/38679372524)
passed signed-tag and DCO verification, Linux build, smoke test, and GHCR publication. Tags
`0.1.0-rc3` and `sha-aef4a15bd0e4` share digest
`sha256:169104ecfd166b85c51343629c42bab0184483d8cf9cde10915f8c493e3f5f99`. Its
browser-reachable endpoint overrides passed a mounted-tree localnet run with JubJub create,
first-device activation, chain read, and open after reload. Use this digest for container-backed
browser deployments. A separate pull of the published digest passed startup smoke, mounted-tree
manifest verification, `/healthz`, browser-reachable `/v1/config`, and a browser open of that account.

Consumers add a scoped registry rule and supply a token outside source control:

```ini
@input-output-hk:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

GitHub Packages requires authentication to install these packages. A local consumer uses a classic token with `read:packages`; a consuming GitHub Actions repository needs package read access for its `GITHUB_TOKEN`. Package administrators can grant teams and repositories access in GitHub. No token belongs in a committed `.npmrc`.

The first live publish from the public source repository created public package records, which were deleted. A restricted personal-token probe created an internal package and was also deleted. All current RC1 package records were created by the private publisher and checked through the Packages API for private visibility. This is why the source repository retains its live-release guard.

The [packaging tracker](https://github.com/input-output-hk/midnight-passport-sdk/issues/31) is the release checklist.


## Next candidate: RC5 (local preparation only)

`0.1.0-rc5` is the proposed next preview, not a published version. See the
[candidate notes]({{ '/release-notes-rc5/' | relative_url }}) and source
`docs/review/rc5/`. Keep existing RC4 installation examples until publication is verified.
Review/merge the stack, run CI on each final head, then use signed tags at the same reviewed
prototype commit for packages and each image. Do not push any release tags as part of local
preparation: those tags trigger workflows and the private package publisher.

Before declaring RC5 published, verify all nine installed registry tarballs against the private
publisher's signed attestation, inspect actual package visibility/access, record each GHCR
manifest digest, pull and smoke the published images, run mounted-tree network checks and
verify the deployed Pages/API links. A local Docker image ID is not a registry manifest digest.
