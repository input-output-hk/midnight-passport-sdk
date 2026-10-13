---
layout: default
title: ZK keys and distribution
permalink: /keys/
---

The ACC build produces three kinds of public artefact: ZKIR, verifier keys and prover keys. The compiler's `contract-manifest.json` records a SHA-256 hash and size for each file. A client or service must pin the manifest hash independently of the server that supplies the bytes.

For the 52-circuit `acc-45721e1` build, the ZKIR directory is about **6.7 MiB**, verifier keys together about **208 KiB**, and prover keys about **11 GiB** on disk. The largest individual prover key is about **495 MB**. These are measurements of the current local build, not a stable size guarantee for a future binding.

| Option                                                           | Advantage                                                                  | Cost and limit                                                                                                                                                                                             |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git LFS for `.prover` files                                      | Prebuilt keys are immediately available after download.                    | Every clone or CI fetch can transfer roughly 11 GiB. LFS charges the repository owner for stored versions and download bandwidth. It is a repository distribution mechanism, not an npm installation path. |
| Pinned ZKIR in the contract package, keys restored at the prover | A small, versioned source artefact; no 11 GiB Git checkout or npm tarball. | The prover spends CPU, memory and startup time compiling each key. A service needs a persistent key cache.                                                                                                 |

**Recommended release path:** package the generated module, manifest, ZKIR and small verifier keys in `mn-passport-contract`; keep `.prover` files out of Git and npm. Run [`restore-acc-keys.mjs`](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/scripts/restore-acc-keys.mjs) in a service build or an installation step, then cache the verified keys by manifest hash. A hosted proving service can additionally distribute a prebuilt, manifest-pinned bundle from object storage for faster cold starts. Git LFS is useful for a team-only snapshot but should not be the default SDK delivery path.

The restore command requires the pinned Compact 0.35.0 Nix shell. It verifies the manifest, then each input ZKIR and regenerated `.prover`/`.verifier` against that manifest before moving keys into the output directory. It rejects mismatched existing files. The expected manifest hash must come from a trusted package version or deployment configuration, **not** from the artefact host being checked.

```sh
nix develop -c node scripts/restore-acc-keys.mjs \
  --source /path/to/pinned-acc-artefacts \
  --output /persistent/cache/keys \
  --manifest-sha256 <independently-pinned-64-hex-sha256>
```

`--circuit deposit_unshielded` restores only one circuit. Re-running the command verifies cached files and skips compilation when they match. The same manifest is the pin the client and service use for the contract binding. The service should refuse to start if its key cache and the package's manifest disagree.

The prototype's [regeneration check](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/experiments/acc-0.35/regen-check.sh) compares independently rebuilt keys byte for byte with the original Compact output. It is the evidence for this choice; a future compiler or binding needs its own full check before publication.

### Release constraints

GitHub Packages caps an npm version tarball below 256 MB, so the full key set cannot be packed there. The current 5 MB **unpacked** artefact budget in the package design also needs remeasurement for the 52-circuit binding: its ZKIR directory alone is above that budget. The package build should set a measured budget for the selected binding, while always excluding prover keys.
