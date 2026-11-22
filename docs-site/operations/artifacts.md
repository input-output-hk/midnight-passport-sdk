# Distribute the contract and public proof artifacts

The `mn-passport-contract` package carries the generated `acc-s3r1.1` binding, capability catalog, ZKIR, verifier material, and integrity manifest. **Prover keys** are much larger and stay outside the npm package. The restore CLI regenerates them from pinned ZKIR with the compatible Compact toolchain and verifies the cache before use. The key service can serve verified files over HTTP, including range requests. A restricted circuit profile cannot prove operations outside that profile.

The application and operator must pin the manifest hash and artifact URL **independently** of the artifact server. `resolveBinding('acc-s3r1.1').manifestSha256` provides the packaged pin; a server's `/v1/config` can be checked against it. Public artifacts are not a reader, owner, viewing secret, wallet seed, proof witness, or authorization token.

For a source checkout with the Nix toolchain, the documented restore command is:

```sh
nix develop -c node packages/contract/bin/restore-acc-keys.mjs \
  --binding acc-s3r1.1 --output /persistent/cache/keys
```

An installed consumer can use the `mn-passport-restore-keys` binary from the exact contract package. Cache by verified manifest and circuit profile; refuse mismatched existing files. The [tagged distribution guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc9/docs/site/keys.md) covers key profiles, hashes, image setup, and HTTP serving. [MIP-0020](/architecture/standards) explains the proposal behind regeneration without replacing the release's concrete manifest.

## Ledger 9 key-generation candidate

The source candidate `acc-s3r1.1-zkir036` keeps the original Compact 0.35
compiler manifest, generated module and ZKIR. It separately pins the Compact
0.36.1 key generator and a complete [52-circuit key inventory](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/examples/midnames-local/evidence/compact0361-acc-key-inventory-20261122.json).
Forty-eight prover/verifier pairs differ from the old profile. The package
includes its separate key manifest, derived artifact manifest and small
ZKIR/verifier bundle; prover keys remain outside the package. The source
compiler manifest stays pinned at `77fb9c17…`, while the derived artifact
manifest that clients must pin for candidate keys has SHA-256
`590d3c97db7fce05d5ea85a9bf37c82b7032c498703a2807276ca7ae0ca52e5f`.
Restore to a cache distinct from the old binding:

```sh
nix develop -c node packages/contract/bin/restore-acc-keys.mjs \
  --binding acc-s3r1.1-zkir036 \
  --output /persistent/cache/acc-s3r1.1-zkir036
```

For an isolated source evaluation, stage the complete candidate tree from the
original compiled ACC output and that restored key cache. The output path must
be new and outside both inputs; the command verifies every copied file against
the pinned derived manifest before publishing the tree:

```sh
nix develop -c node packages/contract/bin/stage-acc-candidate-assets.mjs \
  --source /path/to/original/contracts/managed/account \
  --keys /persistent/cache/acc-s3r1.1-zkir036 \
  --output /persistent/cache/acc-s3r1.1-zkir036-assets
```

On a volume that supports copy-on-write clones, append `--require-reflink` to
avoid a full second copy of the large prover keys. The command refuses that
option if the filesystem cannot clone them.

This source-only staging does not configure the Passport account service or
browser to use the candidate. Preserve the original tree for existing ACCs.

This is an **artifact candidate, not a supported SDK binding**. The published
key-service image, SDK registry, account service and reference demo still select
`acc-s3r1.1`; the current source key service can select the candidate only
explicitly through its versioned URL. An existing ACC with retired maintenance authority cannot have
its verifier keys replaced. The candidate needs separate account deployment,
host routing and operation/provider qualification before support is advertised.
The [version decision](https://github.com/input-output-hk/midnight-passport-sdk/blob/passport-acc-prototype/docs/adr/0020-ledger9-acc-key-generation-binding.md)
tracks those gates.

Application-contract → ACC adopters need the compatible binding and runtime, even if they use none of the browser adapters. The [reference call design](https://github.com/midnightntwrk/passport/blob/e0e4e0e6272399d71dfaaa7cae0689ab4e2363f3/contract/GRANTS-CALLER.md) describes caller pinning; it is not a generic reverse-call facility.
