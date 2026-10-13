---
layout: default
title: Releasing packages
permalink: /releasing/
---

The release target is GitHub Packages under `@input-output-hk/mn-passport-*`, with one version shared by the published package set. Nothing has been published yet.

The [publish workflow](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/.github/workflows/publish.yml) is deliberately gated. It verifies the repository identity, restored seven-day dependency cooldown and active PR checks, built outputs, public package names, versions and packed tarballs. A dry run builds and packs without registry writes. A live run attests the tarballs and publishes them with the workflow `GITHUB_TOKEN`.

Manual dispatch is available only after the workflow file reaches the repository's default branch. Until then, an owner can deliberately push a `sdk-v<semver>` tag pointing to a commit in `passport-acc-prototype` history to start a live release. A prerelease tag publishes with the `dev` distribution tag; a stable version uses `latest`. The tag path has the same release gates and will fail until the remaining package migration is complete. No release tag has been created.

Consumers add a scoped registry rule and supply a token outside source control:

```ini
@input-output-hk:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

GitHub Packages requires authentication even for public npm packages. A local developer uses a classic token with `read:packages`; a consuming GitHub Actions repository needs package read access for its `GITHUB_TOKEN`. No token belongs in a committed `.npmrc`.

The [packaging tracker](https://github.com/input-output-hk/midnight-passport-sdk/issues/31) is the release checklist. A first release also needs a chosen ACC binding, the artefact package, a packed-tarball consumer smoke test and active CI.
