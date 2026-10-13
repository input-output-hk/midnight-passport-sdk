---
layout: default
title: Releasing packages
permalink: /releasing/
---

The release targets only the GitHub Packages npm registry under `@input-output-hk/mn-passport-*`. No package is currently available. The first live `sdk-v0.1.0-rc1` run passed validation and publishing, but GitHub assigned public visibility to all 13 packages because its `GITHUB_TOKEN` came from this public repository. Those package records were deleted. A subsequent restricted publish with a personal token produced **internal** visibility, which does not meet the private-release requirement; that test package was also deleted.

The [publish workflow](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/.github/workflows/publish.yml) verifies the repository identity, seven-day dependency cooldown, PR checks, built outputs and packed tarballs. It installs all 13 tarballs in a clean consumer, imports the account and browser entrypoints, builds a scratch Vite app using the packaged grants binding, and restores a circuit from the packaged ZKIR. The pack manifest records each tarball's SHA-256 digest; each live publish verifies that digest. A dry run builds and packs without registry writes. A live run attests the tarballs and publishes to GitHub Packages with the workflow's `GITHUB_TOKEN`. It does not use an npmjs credential or send packages to npmjs.

Manual dispatch is available only after the workflow file reaches the repository's default branch. A signed `sdk-check-v<semver>` tag pointing to a commit in `passport-acc-prototype` history runs a full dry run. The live `sdk-v0.1.0-rc1` tag exists, but a new guard blocks live publishing from this public repository. Before a live retry, the organization must provide a private publisher repository or another verified way to create **private** packages, and the publisher must verify every package's visibility immediately after creation. `0.1.0-rc1` uses the `next` distribution tag; `-dev` prereleases use `dev`, and stable versions use `latest`.

Consumers add a scoped registry rule and supply a token outside source control:

```ini
@input-output-hk:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

GitHub Packages requires authentication to install these packages. A local consumer uses a classic token with `read:packages`; a consuming GitHub Actions repository needs package read access for its `GITHUB_TOKEN`. Package administrators can grant teams and repositories access in GitHub. No token belongs in a committed `.npmrc`. Do not assume that omitting `--access public` makes a package private: the publish host and organization policy determine the resulting visibility, which must be checked through the Packages API.

The [packaging tracker](https://github.com/input-output-hk/midnight-passport-sdk/issues/31) is the release checklist.
