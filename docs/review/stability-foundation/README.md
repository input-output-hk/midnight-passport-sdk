# Stability foundation: review map and acceptance boundaries

Date: 2026/10/20. Local delivery on the existing branch. Refs #227, #228, #229,
and the initial #231 harness. This prepares one coherent larger PR with signed
commits; it does not authorise a push, issue closure or publication.

## Read in this order

1. [Binding decision](../../adr/0012-retain-binding-with-explicit-removal-and-recovery-limits.md):
   retain the immutable binding with recovery/full compromised-key revocation unsupported.
2. [Source comparison](source-audit.json), [candidate build](candidate-build.json),
   [finalisation comparison](finalisation-comparison.json): exact public source,
   byte-identical declaration evidence and explicitly simulator-only behavior.
3. `scripts/qualification/acc-simulator.mjs`, `tests/contract-entry-semantics.test.mjs`
   and `tests/qualification-roster-boundary.test.mjs`: generated-circuit signatures,
   both owner/remover arms, duplicate counters, pending/future epochs and SDK refusal.
4. `packages/account/src/jubjub-connector.ts` and the new cases in
   `tests/account-jubjub.test.mjs`: refuse active read-grant delivery to the excluded
   reader before publishing anything; keep current key/inbox unchanged on refusal.
5. `scripts/qualification/catalog.mjs`, `receipt.mjs`, `runner.mjs` and
   `scripts/qualify.mjs`: scoped execution, artifact identity, bounded output,
   owned-process deadlines, explicit unavailable gates and three-run validation.
6. [Acceptance index](issue-acceptance.json): 40 open issues, original body hashes,
   206 extracted top-level criteria, implementation/evidence distinctions and closure proposals.
7. [Engineer guide](../../site/qualification.md), compatibility notes, demo labels,
   API comments and affected key/use-case documentation.

## What this slice delivers

| Issue | Local outcome | Boundary |
| --- | --- | --- |
| #227 | Reconciled acceptance index and exact evidence pointers | No remote issue was closed. Source presence is not new flow verification; nested original criteria remain authoritative |
| #228 | Exact source/ABI review, reachability table, both-arm candidate simulation and retention ADR | No candidate binding/VK/prover adoption, proof/node acceptance or maintenance migration |
| #229 | Real-signature entry/counter/epoch regressions, independent viewing-generation checks, safe SDK refusal and corrected claims | Complete compromised-device identity revocation requires upstream contract work |
| #231 | Initial tiered CLI, strict receipts, failure/skip/output/deadline tests and repeated-suite validation | Full outages, published registry and actual provider qualification remain explicit unfinished gates |

The source audit covers the three production Compact inputs. Client viewing-envelope
research and unrelated experimental circuits are not silently adopted. The reviewed
fix clears prior entries; it does not add unique contract-maintained identities for
ordinary individual-device removal. Count/epoch/schema alone cannot identify fixed
verifier code on an imported account.

## Repeatable commands

All Node/pnpm/Compact commands run through Nix. First build the packages, then run:

```sh
nix develop -c pnpm run build
PASSPORT_REPO=/path/to/passport nix develop -c pnpm qualify run foundation \
  --output /private/evidence/foundation-1.json
```

Repeat with new paths twice and use `pnpm qualify repeat` as described in the
[guide](../../site/qualification.md). Receipts are outside Git, pin exact source
bytes and always distinguish scope from release qualification. A changed source,
replayed receipt, skipped assertion or missing scenario invalidates the repeat gate.
The normal full local gate remains required before every commit.

To rebuild the reviewed candidate, export the pinned public source to an ignored
work directory, then from its `contract` directory:

```sh
compact compile +0.35.0 --feature-zkir-v3 --skip-zk \
  contracts/account.compact contracts/managed/account
```

Back in the SDK checkout, run `scripts/qualification/compare-finalisation.mjs`
with the compiled `contract/index.js` path and independently pinned SHA-256 from
[candidate-build.json](candidate-build.json). This never repoints the SDK registry.
Full regeneration, prover/VK hashes, real proof/node behavior and the verifier-wave
budget are adoption gates, not accomplished by `--skip-zk`.

## Internal review checkpoints

- Signature challenges come from the actual generated module; no fake contract
  interpretation is used in simulator cases. Software P-256 is not browser evidence.
- Test-only scalars/nonces and synthetic credentials never become public package APIs.
- SDK removal refuses unsupported rosters, self-removal, absent targets, shared
  readers/signers and a read-grant delivery back to the excluded reader.
- Old viewing context remains readable after rotation; no retroactive-secrecy claim.
- Receipt schemas reject arbitrary metadata, missing cases, evidence-tier relabeling,
  contradictory test counters and release claims. Logs contain hashes/counters only.
- Cache and compiled-module integrity are checked from independent pins before use.
- Timeouts stop only a scenario's newly owned process group; existing services and
  localnets are reused without stop/reset. Evidence is exclusive and crash locks persist.
- Retained binding/generated module/key manifest and exact-value spend guards stay pinned.
- Historical dev-package/browser/host evidence retains its original version/source.
- Larger qualification and migration gaps remain open; no all-green release claim.

Exact commands, verification results, signed commit IDs, redacted receipts and the
private review note are kept in the Midnight Obsidian milestone hub. Do not copy
private consumer research, credentials or security-register material into this PR.

The JubJub removal path also requires exactly one registered target reader before
preparing a new roster, matching the P-256 refusal boundary. Without an identified
target reader, the SDK cannot establish that a read-grant recipient is distinct.
A focused regression verifies no chain call, inbox publication or ACC key switch
on this refusal.

## Review correction — 2026/10/24

The unanchored history fallback/API and the later retained-target-metadata experiment
are withdrawn. The latter could reinclude a pending removal target in another rotation.
Legacy retry/interleaved rotations refuse an unresolved roster, while an original
protected continuation in the dependent durability slice can preserve its verified snapshot only against an unchanged frontier; it is not supplied by this foundation. Earlier secrets remain bounded
decryption candidates without metadata trust or eviction of genuine old coin keys.
Runtime identity includes compiled
inputs, refuses package/dist symlinks, and preflights before evidence reservation.
Repeated outer receipts do not audit omitted runs or external consumer inputs.

### Historical candidate correction — 2026/10/24

The global sixteen-key truncation/refusal is withdrawn: anonymous earlier envelopes
must neither evict a genuine old coin key nor lock sign-in. All distinct earlier
secrets within the existing 4096-envelope bound remain decryption candidates, and
are zeroed after use. Only the ledger-matching current secret/roster authenticates
metadata; earlier candidates never identify device-removal targets. The regression
places a real older coin behind seventeen forged envelopes and verifies metadata,
coin reads, device delivery and new key creation remain usable. Large-inbox work
still scales with candidate keys and coin entries; the existing 4096 limits and
operator/resource qualification remain explicit. No unbounded-input guarantee.
