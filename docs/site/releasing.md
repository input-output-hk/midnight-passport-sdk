---
layout: default
title: Releasing packages
permalink: /releasing/
---

The `0.1.0-rc1` release contains 13 **private** packages in the GitHub Packages npm registry under `@input-output-hk/mn-passport-*`. They use the `next` distribution tag and come from the verified signed `sdk-v0.1.0-rc1` source tag at commit `382ccc6e06c95bcbceb76f00537d565b3c93bcc8`.

The source repository's [publish workflow](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/.github/workflows/publish.yml) runs dry-run validation but blocks live publishing from its public repository. The [private publisher](https://github.com/input-output-hk/midnight-passport-sdk-publisher) checks the signed source tag, the seven-day dependency cooldown, build and test results, then packs and attests all 13 tarballs. Its clean consumer test imports the account and browser entrypoints, builds a scratch Vite app using the packaged grants binding, and restores a circuit from the packaged ZKIR. The pack manifest records each tarball's SHA-256 digest; the private publisher checks it before publishing and verifies the `0.1.0-rc1` version and **private** visibility after each package. The workflow can resume after a partial run. It uses only the private repository's `GITHUB_TOKEN` and publishes only to GitHub Packages.

A signed `sdk-check-v<semver>` tag pointing to `passport-acc-prototype` history runs a dry run in the source repository. For RC1, the private publisher's [visibility probe](https://github.com/input-output-hk/midnight-passport-sdk-publisher/actions/workflows/visibility-probe.yml) published `mn-passport-protocol` first; its [remaining-package workflow](https://github.com/input-output-hk/midnight-passport-sdk-publisher/actions/workflows/publish-remaining.yml) published the other 12. Future releases require updating the pinned source commit and version in that private publisher, reviewing its signed commit, then running the same verification and visibility gate.

Consumers add a scoped registry rule and supply a token outside source control:

```ini
@input-output-hk:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

GitHub Packages requires authentication to install these packages. A local consumer uses a classic token with `read:packages`; a consuming GitHub Actions repository needs package read access for its `GITHUB_TOKEN`. Package administrators can grant teams and repositories access in GitHub. No token belongs in a committed `.npmrc`.

The first live publish from the public source repository created public package records, which were deleted. A restricted personal-token probe created an internal package and was also deleted. All current RC1 package records were created by the private publisher and checked through the Packages API for private visibility. This is why the source repository retains its live-release guard.

The [packaging tracker](https://github.com/input-output-hk/midnight-passport-sdk/issues/31) is the release checklist.
