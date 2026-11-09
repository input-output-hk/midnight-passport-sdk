# Distribute the contract and public proof artifacts

The `mn-passport-contract` package carries the generated `acc-s3r1.1` binding, capability catalog, ZKIR, verifier material, and integrity manifest. **Prover keys** are much larger and stay outside the npm package. The restore CLI regenerates them from pinned ZKIR with the compatible Compact toolchain and verifies the cache before use. The key service can serve verified files over HTTP, including range requests. A restricted circuit profile cannot prove operations outside that profile.

The application and operator must pin the manifest hash and artifact URL **independently** of the artifact server. `resolveBinding('acc-s3r1.1').manifestSha256` provides the packaged pin; a server's `/v1/config` can be checked against it. Public artifacts are not a reader, owner, viewing secret, wallet seed, proof witness, or authorization token.

For a source checkout with the Nix toolchain, the documented restore command is:

```sh
nix develop -c node packages/contract/bin/restore-acc-keys.mjs \
  --binding acc-s3r1.1 --output /persistent/cache/keys
```

An installed consumer can use the `mn-passport-restore-keys` binary from the exact contract package. Cache by verified manifest and circuit profile; refuse mismatched existing files. The [tagged distribution guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc8/docs/site/keys.md) covers key profiles, hashes, image setup, and HTTP serving. [MIP-0020](/architecture/standards) explains the proposal behind regeneration without replacing the release's concrete manifest.

Application-contract → ACC adopters need the compatible binding and runtime, even if they use none of the browser adapters. The [reference call design](https://github.com/midnightntwrk/passport/blob/e0e4e0e6272399d71dfaaa7cae0689ab4e2363f3/contract/GRANTS-CALLER.md) describes caller pinning; it is not a generic reverse-call facility.
