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
