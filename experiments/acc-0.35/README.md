# Experiment — the SDK as a consumer of the Compact 0.35.0 reference ACC

How far can the SDK get with the compiled reference account custody contract
(ACC) on the toolchain released on 2026/09/29: build it reproducibly, size the
package, bind it, load it through midnight-js, and run it on a localnet from
the packaged artefacts. Input to
[FS-0.9](../../docs/roadmap/specs/M0-Foundations/FS-0.9-acc-artefact-package.md).

Run on 2026/10/02, arm64 macOS, in the repository's Nix shell (Compact devtool
0.5.3, compiler `0.35.0 (debb05f94 2026-09-29)`, language 0.27.0, runtime
0.20.0, Node 22.23.2). Every script starts with [`guard.sh`](./guard.sh), which
refuses to run unless `compact` and `COMPACT_DIRECTORY` resolve to the Nix
store and the compiler reports exactly 0.35.0 — a global `compact` can resolve
a different compiler.

**Contract under test:** the planning workspace's
`contract/contracts/account.compact` at revision `a51e2c4` (caller-pinned
scoped grants, `spec_version = 3`, 36 impure circuits), based on `2e3c7ac`.

## Scripts

| Script | Does |
|---|---|
| [`guard.sh`](./guard.sh) | Toolchain gate (see above) |
| [`build.sh`](./build.sh) | `compact compile +0.35.0 --feature-zkir-v3 <src> <out>`, full key generation |
| [`inventory.mjs`](./inventory.mjs) | Per-circuit sizes, the compiler manifest, and a check of every file against it |
| [`consume.mjs`](./consume.mjs) | Unpacks an npm tarball and loads it as a consumer: midnight-js 5 `NodeZkConfigProvider` with the manifest pinned, tamper and wrong-pin refusals, module exports |
| [`fetch-acc.sh`](./fetch-acc.sh) | Exports the ACC's `contract/` tree (and the fixture trees its tests read) at a pinned revision from a local checkout, into `work/` |
| [`compile.sh`](./compile.sh) | Canonical compile of the ACC and its test helpers: `zkir` (no keys) or `full` (every key) |
| [`regen-check.sh`](./regen-check.sh) | Rebuilds prover keys from ZKIR alone with `zkir-v3 compile`, per circuit, and compares them byte for byte with the compiler's |
| [`run.sh`](./run.sh) | Runs the ACC's own test scripts: `offline` suites (circuits executed, no proofs), or an npm script on the localnet with a Docker-memory preflight |

## Run it yourself — the 52-circuit ACC

Everything runs inside the repository's Nix shell; `work/` is git-ignored.
Revision `45721e1` is the planning workspace's `main` with the P-256/WebAuthn
arm (52 impure circuits, `spec_version = 2`); `6458ed5` is the caller-pinned
grants change on top of it (`spec_version = 3`).

```sh
nix develop                                   # or: direnv allow
export PASSPORT_REPO=/path/to/your/passport/checkout
git -C "$PASSPORT_REPO" fetch                 # make sure the revision is present

D=$(experiments/acc-0.35/fetch-acc.sh 45721e1 | tail -1)
```

**1. Circuits without keys (minutes, no Docker).** Compile to ZKIR and execute
every circuit off-chain through the contract's own suites — unit, P-256 (with a
real high-S WebAuthn assertion), grants (121 checks), recovery:

```sh
experiments/acc-0.35/compile.sh "$D" zkir
experiments/acc-0.35/run.sh "$D" offline
```

**2. All keys (the 12 GB problem).** Generates every prover and verifier key on
the host — not in Docker, so Docker's memory does not limit it:

```sh
experiments/acc-0.35/compile.sh "$D" full     # see the measurements below
experiments/acc-0.35/run.sh "$D" offline      # now also runs toolchain-offline
```

**3. Keys from ZKIR alone (the answer to shipping 12 GB).** Rebuild chosen
prover keys from the ZKIR and compare with what the compiler wrote — identical
bytes mean a consumer needs only the ZKIR:

```sh
experiments/acc-0.35/regen-check.sh "$D" deposit_unshielded rotate_enc_key_with_p256
experiments/acc-0.35/regen-check.sh "$D" --all        # every circuit, one at a time
```

**4. Proofs on the localnet.** JubJub and k256 proofs (k ≤ 17) fit the default
Docker VM; P-256 proofs (k = 18) need about 24 GiB — the first one was killed
for lack of memory in an 8 GiB VM. Raise it in Docker Desktop → Settings →
Resources → Memory (this machine has 96 GiB), then:

```sh
experiments/acc-0.35/run.sh "$D" test:auth-coinless   # deploy in waves, JubJub + k256 proofs
experiments/acc-0.35/run.sh "$D" test:p256            # P-256 / WebAuthn proofs; refuses below 24 GiB
experiments/acc-0.35/run.sh "$D" down                 # stop the localnet, drop its volumes
```

`/usr/bin/time -l` in the scripts is the macOS form; on Linux use GNU time's
`-v`.

## Results

### X1 — reproducible build

| | |
|---|---|
| Build | 328 s wall-clock, 2.54 GB peak resident |
| Circuits | 36 proving, 45 pure |
| Sizes | module 1.6 MB; ZKIR 0.8 MB + binary 0.2 MB; verifier keys 88.6 KB; prover keys 5,048 MB |
| Largest prover keys | `publish_recovery_session_with_k256`, `recover_cancel_with_k256` 247.5 MB; the k256 grant twins and k256 shielded withdrawals 234.9 MB |
| Compiler manifest | `compiler/contract-manifest.json` lists all 148 files, keys included; every hash and size matches |
| Determinism | A second build through the SDK's own `build-acc-artefact.mjs`: all 147 artefact files byte-identical. Only the manifest differs, because it records the source map, and the map embeds the invocation's paths (relative `contracts/account.compact` from the contract directory, versus an absolute path). Pinning a manifest hash therefore needs one canonical invocation. |
| Without `--feature-zkir-v3` | The ACC does not compile: `unbound identifier Secp256k1EcdsaSignature` |

Inventory: [`results/x1-inventory.json`](./results/x1-inventory.json).

### X2 — package size (`npm pack`)

| Variant | Files | Packed | Unpacked |
|---|---|---|---|
| Client: module, types, contract info, manifest, verifier keys, `.compact` | 42 | 0.18 MB | 1.83 MB |
| Client + ZKIR | 114 | 0.28 MB | 2.88 MB |
| Everything, prover keys included | 151 | 1,177 MB | 5,051 MB |

GitHub Packages accepts an npm version under 256 MB, so prover keys cannot ship
in the package, compressed or not. They compress about 4.3×.

### X3 — the SDK's binding on the new ACC

`build-acc-artefact.mjs` (patched in a throwaway copy to pass `+0.35.0
--feature-zkir-v3`) pinned the ACC as a second binding version and made it
current. Then `pnpm test`: **23 pass, 9 fail.**

| Failure | Tests | Cause |
|---|---|---|
| Runtime pin | 2 | `Version mismatch: compiled code expects 0.20.0, runtime is 0.16.0` |
| Prototype circuit names | 6 | Tests address `add_device`; the reference ACC has `add_device_with_jubjub` and `add_device_with_k256` |
| Prototype module shape | 1 | `derive_device_commitment` does not exist; the reference has one witness (`held_coin`), 45 per-arm pure circuits, and a 5-argument constructor |

The registry, the multi-version pinning, and the integrity loader carried over
unchanged. Results: [`results/x3-sdk-tests.txt`](./results/x3-sdk-tests.txt).

### X4 — consumer smoke on the packed tarball

| | |
|---|---|
| Loading | 36/36 circuits' ZKIR and verifier keys through midnight-js 5.0.0-rc.2 `NodeZkConfigProvider`, `verify: 'require'`, manifest hash pinned |
| Runtime read from the artefact | 0.20.0 |
| Prover key requested | fails with a plain `ENOENT`, not a typed error |
| Flipped verifier-key byte | `ZkArtifactIntegrityError` |
| Wrong manifest pin | `ZkArtifactIntegrityError` |
| Module exports | `Contract`, `ledger`, `pureCircuits` (45), `circuitSignatures` (81), `declaredInterfaces` (0 — the ACC calls no other contract), `expectedVk` |

Result: [`results/x4-consume.json`](./results/x4-consume.json).

### X5 — localnet from the packaged artefacts

Localnet from [`infra/localnet`](../../infra/localnet) (node `2.1.0-1b2b31c7`,
proof server `9.0.0-rc.8`, indexer `4.4.0-rc.6`; image digests equal to the
contract team's 0.35.0 verification). The contract team's own on-node
caller-pin conformance test ran with `contracts/managed/account` replaced by
the X4 package plus the prover keys from X1 as an overlay — standing in for the
separate prover-key bundle.

See [`results/x5-localnet.md`](./results/x5-localnet.md).

### X6 — the 52-circuit ACC: full key build, and correspondence (2026/10/03)

Revision `45721e1` (P-256/WebAuthn arm). Full build 1,313 s, peak 7.2 GB on the
host; 52 proving circuits; prover keys 12,175.5 MB (largest 495.0 MB).
**All 162 published ZKIR, prover-key and verifier-key hashes of the contract
team's build are identical to ours** (their M4 Max and installer toolchain; our
M2 Max and Nix). See [`results/x6-full-build-45721e1.md`](./results/x6-full-build-45721e1.md).

### X7 — P-256/WebAuthn proofs on the localnet (2026/10/03)

The contract team's on-node P-256 scenario, unmodified: **PASS**, 21
transactions, P-256 account proofs 30–54 s, proof server at 13.5 GiB while
proving the WebAuthn probe. See [`results/x7-p256-localnet.md`](./results/x7-p256-localnet.md).
