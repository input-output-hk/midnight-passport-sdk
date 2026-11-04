# Host configuration inspection (local candidate)

`inspect.ts` is a strict TypeScript composition example for the candidate
`contract/capabilities` and `account/preflight` entries. Published RC6 lacks these
new entries. Use candidate tarballs from this branch; do not relabel RC6 evidence.

Pass the host's trusted `Partial<PassportPorts>` and one of the four covered existing
sealed-owner operations. The function invokes no ports or loaders; the caller can
show missing member paths before any key ceremony. A report with no issues still
requires runtime validation. It does not execute an account operation or establish
full Lace, browser/provider, proving, sponsorship or wallet compatibility.

Both supported authoriser arms are treated explicitly; an unknown/k256 arm never
falls back to P-256. This adds no package, host-specific dependency or outgoing ACC
bundle requirement. See `docs/site/capabilities.md` for the profile boundaries and
separate authority, artifact and evidence checks.


`inspectHostProofs` additionally takes parsed key-server profile/manifest JSON and
checks the account operation's exact key set before a ceremony. It rejects known
missing provers even when every verifier is present. Coverage is advertised metadata
only; actual artifact hashes, network configuration and runtime authority remain
independent checks. A materialized binding is checked for required helper methods;
lazy loaders are deliberately not invoked.


## Run against a key endpoint

After installing the matching candidate account/contract packages into your app,
copy `check-key-endpoint.mjs` there and run with Node 22:

```sh
node check-key-endpoint.mjs http://127.0.0.1:8788 jubjub-schnorr withdraw-unshielded
node check-key-endpoint.mjs http://127.0.0.1:8788 jubjub-schnorr issue-grant read
```

Choose the endpoint deliberately; this does not start a key server or any Docker
stack. Exit0 means advertised coverage, exit2 means missing/invalid profile coverage,
exit1 means unavailable/malformed metadata, exit3 means invalid arguments. Both
metadata requests share a five-second deadline and each response is bounded to
256KiB. Redirects and credential/query/fragment URLs are refused. No authentication
headers or credentials are read; authenticated hosts can fetch metadata with their
reviewed client and call `inspectAccProofProfile` directly. Never put tokens in URLs.
The CLI reads only `/v1/profile` and `/v1/manifest`, not prover files, credentials or
wallet endpoints. All later integrity, ownership, finality and provider checks remain.

The fast `tests/partner-recipes.test.mjs` gate compiles the TypeScript examples
against declared public package exports and executes the emitted journal recipe.
It also drives this CLI over real loopback HTTP with missing keys, malformed/large
responses, redirects and invalid arguments. No package install or proof in fast CI.
Installed-candidate checks are separate; local public-export maps do not prove
registry/package provenance.
