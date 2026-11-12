# Distribute the contract and public proof artifacts

The `mn-passport-contract` package carries the generated `acc-s3r1.1` binding, capability catalog, ZKIR, verifier material, and integrity manifest. **Prover keys** are much larger and stay outside the npm package. The restore CLI regenerates them from pinned ZKIR with the compatible Compact toolchain and verifies the cache before use. The key service can serve verified files over HTTP, including range requests. A restricted circuit profile cannot prove operations outside that profile.

The application and operator must pin the manifest hash and artifact URL **independently** of the artifact server. `resolveBinding('acc-s3r1.1').manifestSha256` provides the packaged pin; a server's `/v1/config` can be checked against it. Public artifacts are not a reader, owner, viewing secret, wallet seed, proof witness, or authorization token.

## Public artifacts for the browser proving worker

The source candidate exports `createBrowserProofArtifacts` from
`adapter-browser/worker-proof-artifacts`. Give its callbacks to the trusted
local WASM prover inside the dedicated worker. Pin the binding manifest, circuit
allowlist, and absolute `/v1/zk/<bindingId>` URL in the host. Pin each Ledger
parameter URL, SHA-256 and byte size separately from the ACC manifest.

The loader requests complete files using GET without credentials, referrer, or
redirects. It bounds decoded response bytes and verifies the verifier key,
binary ZKIR and prover key against the packaged binding. Unknown circuits and
unexpected verifier hashes fail before a download. Configure allowed origins on
the key service when serving cross-origin. The default 128 MiB limit applies per
ACC file. Raising it for a larger prover key requires host memory qualification.
The worker keeps the most recently loaded key set and parameter set in memory.
Treat the verified byte arrays as read-only in the trusted proving engine.
Pin the WASM build independently. [Worker integration](/guides/hosts#browser-worker-proving-in-the-source-candidate)

For a source checkout with the Nix toolchain, the documented restore command is:

```sh
nix develop -c node packages/contract/bin/restore-acc-keys.mjs \
  --binding acc-s3r1.1 --output /persistent/cache/keys
```

An installed consumer can use the `mn-passport-restore-keys` binary from the exact contract package. Cache by verified manifest and circuit profile; refuse mismatched existing files. The [tagged distribution guide](https://github.com/input-output-hk/midnight-passport-sdk/blob/sdk-v0.1.0-rc9/docs/site/keys.md) covers key profiles, hashes, image setup, and HTTP serving. [MIP-0020](/architecture/standards) explains the proposal behind regeneration without replacing the release's concrete manifest.

Application-contract → ACC adopters need the compatible binding and runtime, even if they use none of the browser adapters. The [reference call design](https://github.com/midnightntwrk/passport/blob/e0e4e0e6272399d71dfaaa7cae0689ab4e2363f3/contract/GRANTS-CALLER.md) describes caller pinning; it is not a generic reverse-call facility.
