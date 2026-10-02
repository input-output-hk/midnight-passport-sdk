# X6 — full key build of the 52-circuit ACC, and correspondence with the contract team's build

2026/10/03, Apple M2 Max (12 cores, 96 GiB), the repository's Nix shell
(compiler `0.35.0 (debb05f94 2026-09-29)`). Revision `45721e1`: the planning
workspace's `main` with the P-256/WebAuthn arm.

    experiments/acc-0.35/compile.sh <contract-dir> full

## Build

| | |
|---|---|
| Account, ZKIR only (`zkir` mode) | 268 s, peak 4.2 GB |
| Account, all keys (`full` mode) | 1,313 s (21.9 min), peak 7.2 GB — on the host, not in Docker |
| Circuits | 52 proving, 65 pure |
| Sizes | module 2.1 MB; ZKIR 4.9 MB + binary 1.6 MB; verifier keys 132.8 KB; **prover keys 12,175.5 MB**, largest 495.0 MB |
| Compiler manifest | lists all 212 files, keys included; every hash and size matches |

Inventory: [`x6-inventory-45721e1.json`](./x6-inventory-45721e1.json).

## Correspondence with the contract team's build

The contract team publishes exact source, ZKIR, prover-key and verifier-key
hashes for this revision (`contract/evidence/p256-webauthn/circuit-sizes.json`,
built on an Apple M4 Max with the `compact` installer's toolchain).

| | Result |
|---|---|
| Sources (`account`, `account-p256`, `webauthn`, `probe-p256`) | 4/4 identical |
| Assets: ZKIR, prover key, verifier key for 52 account + 2 probe circuits | **162/162 identical** (size and SHA-256) |

Different machine, different chip generation, different packaging of the same
compiler release: identical bytes, prover keys up to 495 MB included. An SDK
build from the pinned revision therefore corresponds to the contract team's
build by construction — the "deploy correspondence" risk is closed by a hash
comparison, and ADR 0004's open cross-machine question is answered.
