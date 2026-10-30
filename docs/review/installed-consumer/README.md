# Installed candidate interruption qualification

Refs #81/#231. Follows PR #252 at signed `7e0bb40`; local follow-up only.
Published RC5, runtime/binding pins and exact-value withdrawal guards are unchanged.

## Review order

1. `scripts/consumer/installed-inputs.mjs`: bounded gzip/tar parsing without
   extraction; header checksums, paths, duplicate/special/link refusal, npm
   identity and complete installed file-set/byte comparison. Root pnpm dependency
   subtrees are separate; this is not an audit of every transitive dependency byte.
2. `scripts/qualify-installed-consumer.mjs`: fresh out-of-workspace preparation,
   copied authenticated nine-file bundle, retained exact package/lock hashes,
   offline frozen replay, physical runtime identity, before/after audit and
   immutable private receipts. No registry or wallet writes.
3. `scripts/consumer/installed-host-jobs.mjs`: copied unchanged into the installed
   application's own module tree; bare installed imports, eight actual HTTP and
   process-KILL cases, no workspace package imports at runtime, original-ID
   continuation, unchanged synthetic ledger and refusal to prepare/submit on
   recovery. Claimed-before-host cases intentionally remain unknown.
4. Installed hosted-consent probe: exact descriptor preservation, lossy branding
   refusal and three unsupported owner-flow refusals without entering a host
   session or reading secrets. Synthetic host, not an actual Lace/provider test.
5. `installed-cases.mjs` and ordinary tests: require all distinct scope combinations
   and zero recovery effects; reject missing, duplicate and overclaimed evidence.
   Integrity negative controls run quickly without installation or Docker.
6. Consumer/qualification engineer guides and `AGENTS.md`: reproducible commands,
   honest tier boundaries and retention/cleanup policy.

The source files in type annotations are compile-time harness checks only. The
copied runtime imports resolve through the separate application's `node_modules`.
Installed SDK symlinks/files escaping that tree and local file overlays fail the
audit; the supported pnpm layout uses internal links into its own `.pnpm` tree.

The local manifest establishes supplied-file integrity, not publisher identity.
A lock freezes dependency resolution and runtime copies; it does not qualify all
operation families or actual host releases. Real proof, image, provider and Lace
acceptance stay distinct. Do not automatically close broad #81/#231/#232.

## Local acceptance — 2026/10/30

The public `pnpm qualify run consumer-installed --output …` command passed at clean
GPG/DCO-signed `12f40019ee71163aa7636f81b47bd6383b064d99`; the invoking workspace
fingerprint stayed unchanged. See [the outer receipt](suite-receipt.json),
[installed receipt](installed-receipt.json) and [verification](verification.json).
The outer stdout digest equals the complete inner receipt bytes. The candidate
`0.1.0-installed.20261030` is a local test version of unchanged production SDK
source from #252, not a new registry release.

A second fresh consumer installed the same nine tarballs with the first consumer's
exact lock offline/frozen. All eight both-arm call/deploy process cases and the
synthetic hosted-consent checks passed; the signed-source scenario took 2,938 ms
on this machine, not a promised CI latency. Three deliberate tamper controls
(lock, bundle, installed SDK file) failed before creating any new scenario run,
then restored the exact bytes. A matching-harness controller SIGTERM probe exited
with code 2 and terminated its observed owned worker. No native Docker or wallet
resources were started. Historical synthetic unknowns remain retained privately.

The full Nix gate passed 999 tests with seven existing conditional skips and zero
failures; Jekyll built 21 pages / 463 valid local links and anchors. The new cheap
archive/receipt controls are in normal tests; installing dependencies and process
qualification remain opt-in. Documentation after this signed execution does not
retroactively qualify a different source or package graph.


## Historical receipt boundary after the RC6 retained-result change

The receipts above belong to12f4001/default TTL. The later harness deliberately
requires TTL-zero case evidence; do not validate/relabel the old receipt with that
new schema. [RC6 candidate evidence](../rc6-candidate/README.md) records the fresh
c754615 run, its own tarball and harness hashes, and eight TTL-zero cases. The
release gate executes the new harness against the exact release package graph.
