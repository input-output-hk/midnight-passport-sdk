# Release acceptance and mounted qualification review map

Source-preview delivery for #236 and #313, after immutable RC9. No release or
GitHub issue is completed merely by adding these tools. New actual receipts must
identify the checked-in signed runner and their own input/evidence tier.

| Boundary | Implementation | Regression evidence |
| --- | --- | --- |
| Closed, independently hash-pinned operator plans | `scripts/release/plan.mjs`, `mounted-plan.mjs`, example JSON | Plan/admission and topology tests |
| Bounded exact-origin registry/CDN transport | `transport.mjs`, `registry.mjs` | `tests/release-transport.test.mjs`: downgrade, userinfo, foreign/duplicate redirects, ambiguous query and body bounds |
| Actual compressed archive/source/provenance identity | `registry.mjs`, `signatures.mjs`, `reproducibility.mjs` | Integrity/header mutation and GPG signer tests; actual registry lane separately |
| Installed public entrypoints/full graph | `installation.mjs`, existing `scripts/consumer/installed-release.mjs` | Existing installed quality/crypto/interruptions; actual clean install separately |
| Anonymous digest pull and production runtime | `images.mjs`, `image-runtime.mjs`, `key-runtime.mjs` | Metadata/catalog/range mutation tests; actual pulled-image lane separately |
| Uploaded artifact → anonymous Pages | `pages.mjs`, `instructions.mjs`, bounded `safeArchive` site mode | Unsafe tar/duplicate/link and stale active command tests; live Pages separately |
| Durable Docker acquisition/control | `resources.mjs`, `docker.mjs` | Stateful side-effect-then-lost-reply fake, late creation, init/start uncertainty, cleanup/inspection failure |
| Final native acceptance | `mounted-interval.mjs`, `mounted.mjs`, `mounted-inputs.mjs` | Production coordinator fault tests: every input drift, partial setup, substituted lease, process closure and final helper cleanup |
| One genesis wallet and original operations | `mounted-services.mjs`, `mounted-client.mjs`, `qualify-rc-localnet.mjs` | Real owned-child closure; fresh mounted flow separately; private synthetic fixture before dispatch |

The source client retains a synthetic fixture and account records. It does not
offer resumable account creation or replace a protected host-job continuation.
Unknown creation/funding intent requires reconciliation with retained chain/service
state. Source-client native evidence is not registry-installed native or job-backed
image fault evidence. P-256/provider/Lace scope is unchanged.

Read-only source/tag verification does not change ownertrust or refs. Signed SDK
artifact source, publisher source, documentation deployment and runner source are
separate axes. A new runner does not retag old evidence. Active README commands are
examined as commands; historical release prose is not rejected for mentioning old
versions. The actual deployment must match its exact uploaded workflow artifact.

All root/app/package READMEs and getting-started/operations guides are scanned for
current fenced installation/image commands. Preserve historical fenced commands
only inside balanced `release-acceptance:historical:start` / `:historical:end`
HTML comments. Unmarked commands are current; the checker still requires actual
current installation and all three image recipes, independently of history.

Private receipts, original findings/corrections and signed checkpoints belong in
the owner's knowledge base, not in public docs. Preserve all failed attempts and
retained resources. Native work must follow the runbook and current owner scope.
