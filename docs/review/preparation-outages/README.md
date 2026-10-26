# Preparation races and current-harness outages — 2026/10/26

Refs #230/#231/#232. Current branch baseline649c85d; this is source milestone work,
not a release or real-provider acceptance.

## Review order

1. `tests/host-mutations.test.mjs`: two held producers, release the stale preparer
   before the successor completes; memory and encrypted-file CAS stores. Conflicting
   original call bytes cannot claim or prepare; persistent preparation refusal and
   a ready step whose validation/expiry guard refuses cannot dispatch/replace bytes.
2. `tests/host-mutation-http.test.mjs`: real authenticated loopback HTTP/client
   composition. Transient preparation resumes through a fresh executor over the
   same in-memory store; incorrect auth/pins/input cannot prepare. Persistent
   refusal sanitises protected diagnostics. Cancellation and actual client timeout
   during held preparation save the original output and require explicit same-ID
   reconciliation; no automatic execute retry. These are fake chain/driver tests,
   not native transaction or fresh-process acceptance.
3. Closed error classification: exact operation/fault, one failure summary, matching
   code/unresolved effect and no conflicting success. Exact host exit86/crash marker;
   prover handshake names the expected boundary. Unknown reconciliation preserves
   both host records and observed send count.
4. `survivorOutageStages` / explicit suite entrypoints: original create crosses
   deployment submit crash, committed-plan prover outage and activation submit
   crash; then actual grant/holding setup, survivor enrollment, target enrollment
   and removal crashes, survivor rotation crash, removed-reader refusal, and the
   final owner pre-registration prover failure that intentionally stays unresolved.
5. Native receipt inventory/source/reference/image pins, positive reader/holding/
   grantee checks, original IDs/plans/bytes and no duplicate sends. Both-arm and
   explicit per-arm suites cannot be narrowed by an ambient profile.

## Recorded evidence

Signed source `5d2bf2062fab64a40eadee009823e7a69bd70cc6` completed the explicit both-arm `survivor-outages`
profile: **32 passed entries, 88 confirmed host transactions and zero duplicate
host sends**, with ten actual indexer-down probes and four actual prover stops.
Jubjub contributed 44 host transactions and P-256 44. Each arm used one original
create intent across its three interruptions. Original plans and prepared bytes
were preserved. The final owner pre-registration proof failure intentionally
remains unresolved; same-ID resume preserved host records and send count.

| Scope | Jubjub | P-256 |
| --- | --- | --- |
| Deployment/prover/activation interruptions and original create resume | Pass | Pass |
| Active grant and seven-unit shielded test holding | Pass | Pass |
| Independent survivor enrollment | Pass | Pass |
| Target enrollment and removal host/indexer interruptions and original resume | Pass | Pass |
| Survivor-authorized rotation interruption and original resume | Pass | Pass |
| Removed reader cannot open the current key | Pass | Pass |
| Owner proof failure before host registration | Safely unresolved, no resend | Safely unresolved, no resend |

The complete local source gate passed 906 tests, with 7 existing conditional skips
and zero failures. The new engine/HTTP cases passed 31 focused tests without skips.
[Verification](verification.json) retains source/runtime/reference/image pins,
raw receipt digests, per-arm outcomes and scope limits. The source and compiled
workspace and the selected reference fingerprints remained unchanged through the
native run. Later documentation changes must preserve these executable inputs.

The first native attempt at `48262a2` remains **FAIL**. Its deployment post-submit
host loss correctly returned `MutationUnsettled`; the harness had expected
`InternalError`. The specific mapping was corrected and alternate-code negative
controls added. Source/runtime/reference end audit passed for the failed attempt;
its original pending intent was retained and never replayed. Production behavior
was unchanged. The later successful run used fresh independent fixtures.

This is one software-identity localnet round per arm, not three consecutive
release runs, real-provider qualification or full issue acceptance. Private
identities, journals, native request arguments and uncertain intents remain
outside Git and the Vault. See [executable comparison](executable-inputs.json)
for the documentation forwarding audit.

## Limits

Mock validation refusal tests exercise executor/HTTP control flow; native TTL
validation is a separate existing ledger test. Preparing-call reconcile may
continue original already-built bytes under original approval, unlike uncertain
broadcast lookup. Custom drivers must preserve input/authority and never re-prove
or rebalance during call prepare. All narrower unknown/frontier/key-origin/
constructor/expiry refusals remain. No atomic compromised-signer retirement,
key-loss recovery, native grant crash continuation, real browser/provider, full
Lace or complete three-run release acceptance. Keep exact-value shielded guards.
