---
layout: default
title: ZK keys and distribution
permalink: /keys/
---

The ACC build produces three kinds of public artefact: ZKIR, verifier keys and prover keys. The compiler's `contract-manifest.json` records a SHA-256 hash and size for each file. A client or service must pin the manifest hash independently of the server that supplies the bytes.

For the first `0.1.0-rc1` binding, the selected source is Passport revision `6458ed5` (P-256 plus caller-pinned grants, on-chain spec version 3). The generator `scripts/build-acc-binding-v2.mjs` verifies the full source revision and the hashes of both imported Compact files, compiles with the canonical Compact 0.35.0 invocation, and checks every output against the compiler manifest. Its generated JSON records the compiler and Nix toolchain, manifest hash, and SHA-256 and size of every circuit's ZKIR, prover and verifier keys. `pnpm run package:acc-s3r1.1` copies the pinned generated JavaScript and types into the contract package, where consumers can import `@input-output-hk/mn-passport-contract/bindings/acc-s3r1.1` with Compact runtime `0.20.0`. The package also contains the `acc-s3r1.1` ZKIR/verifier bundle and readable key manifest. Restore its keys with `nix develop -c node packages/contract/bin/restore-acc-keys.mjs --binding acc-s3r1.1 --output /path/to/cache`. The existing `acc-45721e1` bundle still serves the prototype until the new binding is integrated.

For `acc-s3r1.1`, the 52 circuits have **4,984,299 bytes of text ZKIR**, **1,597,918 bytes of binary ZKIR**, **132,804 bytes of verifier keys**, and **12,175,495,280 bytes of prover keys**. The ZKIR/verifier bundle is **1,380,821 bytes compressed**. The release contract tarball is **2,886,756 bytes compressed** and **5,252,279 bytes unpacked**, including the earlier prototype bundle. These are measured build outputs, not limits for later bindings.

| Option                                                           | Advantage                                                                  | Cost and limit                                                                                                                                                                                             |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Git LFS for `.prover` files                                      | Prebuilt keys are immediately available after download.                    | Every clone or CI fetch can transfer roughly 11 GiB. LFS charges the repository owner for stored versions and download bandwidth. It is a repository distribution mechanism, not an npm installation path. |
| Pinned ZKIR in the contract package, keys restored at the prover | A small, versioned source artefact; no 11 GiB Git checkout or npm tarball. | The prover spends CPU, memory and startup time compiling each key. A service needs a persistent key cache.                                                                                                 |

**Release path:** `mn-passport-contract` packages the generated module, [key manifest](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/packages/contract/resources/acc-s3r1.1.key-manifest.json), ZKIR and small verifier keys. `.prover` files stay out of Git and npm. Run `mn-passport-restore-keys` in a service build or deployment step, then cache the verified keys by manifest hash. A hosted proving service can also distribute a prebuilt, manifest-pinned bundle from object storage for faster cold starts. Git LFS remains useful for a team snapshot, but the SDK delivery path uses pinned ZKIR.

The readable JSON lists SHA-256 and size for every circuit's ZKIR, binary ZKIR, prover and verifier files. It also records the compiler version and commit, the `zkir-v3` command, and hashes of the Nix Compact recipe and `flake.lock` used to select the toolchain. The restore command requires the pinned Compact 0.35.0 Nix shell. It checks the readable JSON against a hash pinned in package code, verifies it against the compiler manifest, then checks bundled inputs and regenerated `.prover`/`.verifier` files before moving keys into the output directory. It rejects mismatched existing files. A service may also pass `--manifest-sha256` from its deployment configuration. Never take that pin from the artefact host being checked.

```sh
nix develop -c node packages/contract/bin/restore-acc-keys.mjs \
  --binding acc-s3r1.1 \
  --output /persistent/cache/keys
```

After package publication, consumers can invoke `mn-passport-restore-keys` from the installed contract package. `--circuit deposit_unshielded` restores only one circuit. `--source /path/to/managed/account` or `--bundle /path/to/bundle` selects another input and may be combined with an independent `--manifest-sha256` pin. Re-running the command verifies cached files and skips compilation when they match. The service should refuse to start if its key cache and the package's manifest disagree.

The [bundle builder](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/scripts/build-acc-key-bundle.mjs) verifies every input against the compiler manifest before compressing it. The restore CLI verifies the full bundle against an independent manifest pin. The [regeneration check](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/experiments/acc-0.35/regen-check.sh) rebuilt all 52 circuits for `acc-s3r1.1` and compared both keys byte for byte with the original Compact output. A later compiler or binding needs its own full check before publication.

### Release constraints

GitHub Packages caps an npm version tarball below 256 MB, so the full key set cannot be packed there. The release contract package measures about 5.25 MB unpacked and 2.89 MB compressed. This exceeds the earlier 5 MB unpacked design estimate because it includes both bindings; the release inspector enforces the registry's tarball limit and rejects any `.prover` file.
