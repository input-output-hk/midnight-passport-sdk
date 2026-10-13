# 0008 — Restore prover keys from pinned ZKIR

Date: 2026/10/13 · Status: proposed · Addresses: FS-0.9 OQ-6 and the SDK publishing design §6.5
Refs: [publishing tracker #31](https://github.com/input-output-hk/midnight-passport-sdk/issues/31)

## Context

The 52-circuit ACC build at `acc-45721e1` has about 11 GiB of `.prover` files on disk. The largest file is about 495 MB, while its ZKIR directory is about 6.7 MiB and all `.verifier` files together are about 208 KiB. The [GitHub Packages npm limit](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry) is below 256 MB per version tarball. Prover keys therefore cannot be part of `mn-passport-contract` or a single ordinary npm package.

Git LFS can hold individual keys, but the whole set is large: downloads and every new version count against the repository owner's [LFS storage and bandwidth](https://docs.github.com/en/billing/concepts/product-billing/git-lfs). It also makes every full checkout and release runner download large public build outputs. GitHub recommends keeping [programmatically generated files outside Git](https://docs.github.com/en/repositories/creating-and-managing-repositories/repository-limits).

The existing compiler manifest pins the SHA-256 and size of each ZKIR, prover and verifier file. The `zkir-v3 compile` command can reconstruct both keys from one `.zkir` file. On 2026-10-13, `experiments/acc-0.35/regen-check.sh <contract-dir> --all` completed successfully for all 52 circuits: every regenerated prover and verifier key was byte-for-byte identical to the original Compact output.

## Proposed decision

- Ship the generated module, manifest, ZKIR and small verifier keys in the versioned contract package. Ship no `.prover` files in npm, Git or Git LFS as the default path.
- Pin the manifest hash in the package registry. A service receives that trusted pin with its binding configuration, verifies the ZKIR, then runs the pinned Compact `zkir-v3` toolchain to restore keys into a persistent cache. Each output is checked against the manifest before use. `scripts/restore-acc-keys.mjs` implements this operation for the prototype binding.
- Key the cache by binding id and manifest hash; never use a directory shared across incompatible manifests. Do not compile a key on every proof. A service may prebuild the cache as an image layer or deployment step.
- An operator needing fast cold starts may publish a separately versioned, manifest-pinned archive to object storage or an OCI registry. The proving service fetches it directly and verifies the same hashes. This is an optimisation, not another source of truth.
- Keep LFS as an opt-in internal snapshot if a team specifically needs prebuilt files in a checkout. Do not make it a required dependency of an SDK install or CI release.

## Consequences and gates

Regeneration consumes CPU, memory and time; the service needs persistent storage and a prepared cache before it serves proofs. Determinism must be rechecked for **every** new binding and toolchain. The package's existing 5 MB unpacked size budget needs remeasurement for this 52-circuit binding, since the ZKIR directory alone exceeds it. The contract package assembly work must include a size check that excludes `.prover` and includes the chosen ZKIR set.

This ADR becomes accepted only after the owner chooses this distribution path. It does not authorise publishing any package or key bundle.
