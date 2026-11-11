# Prepare a standalone Midnames registry

This fixture uses the Midnames 2.1.0 registry source on the Passport standalone
Ledger 9 stack. Prepare artifacts with the Passport SDK's pinned Nix toolchain.
Supply a local copy of `ns.compact` from the source revision recorded in
[the manifest](registry-manifest.json). The command verifies those bytes,
updates the language pragma for Compact 0.35.0, and verifies each generated
module, circuit, prover and verifier against the reviewed hashes.

```sh
nix develop -c node examples/midnames-local/prepare.mjs \
  /absolute/path/to/ns.compact /absolute/path/to/fresh-output
```

The output directory must be new. A failure leaves the original diagnostics
and partial output available for inspection. Use the standalone resolver
profile only on `undeployed`. It requires the deployed registry to match all
13 verifier hashes. The deployed Passport ACC must still match its own pinned
binding and be activated. The registry build and key checks are prerequisites
for live qualification.

The standalone fixture has the upstream transitional registry administration
semantics. A name claim needs an owner-controlled proof witness. Use synthetic
wallets for this qualification and preserve all original transaction references
when a submission has an uncertain result.
