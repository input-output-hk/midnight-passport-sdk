---
layout: default
title: Releasing packages
permalink: /releasing/
---

The `0.1.0-rc1` release contains 13 **private** packages in the GitHub Packages npm registry under `@input-output-hk/mn-passport-*`. They use the `next` distribution tag and come from the verified signed `sdk-v0.1.0-rc1` source tag at commit `382ccc6e06c95bcbceb76f00537d565b3c93bcc8`. Five of those packages were empty scaffolds. The next release packs nine implemented packages, including the Node `service` HTTP core; the five scaffolds remain private workspace packages and their RC1 records stay available. The private publisher accepts this nine-package roster from RC2 onward. A [source dry run](https://github.com/input-output-hk/midnight-passport-sdk/actions/runs/38629793752) on `passport-acc-prototype` built, packed, and consumer-smoke-tested all nine packages before the next release tag.

The source repository's [release-check workflow](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/.github/workflows/publish.yml) builds, tests, packs, smoke tests, and attests a signed release tag. The [private publisher](https://github.com/input-output-hk/midnight-passport-sdk-publisher) checks for a passing release every 15 minutes, verifies the signed source tag and commit, then independently runs the build and packaging checks. Its clean consumer test imports the account and browser entrypoints, builds a scratch Vite app using the packaged grants binding, and restores a circuit from the packaged ZKIR. The pack manifest records each tarball's SHA-256 digest; the private publisher checks it before publishing and verifies the release version and **private** visibility after each package. The workflow can resume after a partial run. It uses only the private repository's `GITHUB_TOKEN` and publishes only to GitHub Packages.

A signed `sdk-check-v<semver>` tag pointing to `passport-acc-prototype` history runs a dry run in the source repository. To publish, push a GPG-signed annotated `sdk-v<semver>` tag pointing to a signed, DCO-signed commit in that branch's history. Once the source release check passes, the private publisher picks it up automatically. Its [workflow](https://github.com/input-output-hk/midnight-passport-sdk-publisher/actions/workflows/publish.yml) can also be started manually with the tag to avoid waiting for the next scheduled run.

Container images use separate signed tags and workflows. The [key image](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-key-service/README.md) is published as `ghcr.io/input-output-hk/midnight-passport-keys:<version>` from `keys-v<version>`. The [funding image](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/apps/passport-funding-service/README.md) uses `ghcr.io/input-output-hk/midnight-passport-funding:<version>` from `funding-v<version>` once its build and mounted-tree checks pass. Image workflows also tag the exact source SHA; pin the resulting digest in deployments. The funding image needs a Linux-prepared pinned ACC tree, a separate wallet seed outside localnet, private token and asset policy files, and persistent reservation/wallet state.

Consumers add a scoped registry rule and supply a token outside source control:

```ini
@input-output-hk:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

GitHub Packages requires authentication to install these packages. A local consumer uses a classic token with `read:packages`; a consuming GitHub Actions repository needs package read access for its `GITHUB_TOKEN`. Package administrators can grant teams and repositories access in GitHub. No token belongs in a committed `.npmrc`.

The first live publish from the public source repository created public package records, which were deleted. A restricted personal-token probe created an internal package and was also deleted. All current RC1 package records were created by the private publisher and checked through the Packages API for private visibility. This is why the source repository retains its live-release guard.

The [packaging tracker](https://github.com/input-output-hk/midnight-passport-sdk/issues/31) is the release checklist.
