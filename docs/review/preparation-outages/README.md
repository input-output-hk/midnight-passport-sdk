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

## Evidence status

Source48262a2 passed906tests with7existing conditional skips and zero failures;
Jekyll checked20pages/415links and anchors. The first native attempt stopped on a
qualification expectation defect: deployment post-submit host loss correctly
returned `MutationUnsettled` while the harness expected `InternalError`. The exact
mapping is corrected; both alternate codes remain negative controls for other
registered boundaries. The failed receipt and original pending intent are retained;
end audit confirmed unchanged source, compiled inputs and reference export. This
is a harness correction, not a production behavior change. Native acceptance is
pending a fresh signed-source run.
No runner existence or skipped test establishes a pass. Later proof results must
retain exact actual source pins and failed attempts. Previous native receipts
remain historical, not relabelled as current-harness qualification.

## Limits

Mock validation refusal tests exercise executor/HTTP control flow; native TTL
validation is a separate existing ledger test. Preparing-call reconcile may
continue original already-built bytes under original approval, unlike uncertain
broadcast lookup. Custom drivers must preserve input/authority and never re-prove
or rebalance during call prepare. All narrower unknown/frontier/key-origin/
constructor/expiry refusals remain. No atomic compromised-signer retirement,
key-loss recovery, native grant crash continuation, real browser/provider, full
Lace or complete three-run release acceptance. Keep exact-value shielded guards.
