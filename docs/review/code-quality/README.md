# Independent code-quality audit — 2026/11/02

Requested by the owner as part of the approved stability plan [#257](https://github.com/input-output-hk/midnight-passport-sdk/issues/257).
A separate sub-agent audited source `0e959a9` read-only: production HTTP, account/funding,
journals/jobs/grants, and native qualification composition. [Report](report.md).
This is bounded independent review, not a security certification.

| Finding | Priority | Backlog / disposition |
| --- | --- | --- |
| Malformed HTTP target terminates process | P1 | [#260](https://github.com/input-output-hk/midnight-passport-sdk/issues/260); fixed locally in GPG/DCO commit `ee3d71c`, raw socket survival regression, pending reviewed merge/release |
| Same-ID shielded deposit cannot recover original confirmed result | P2 | [#261](https://github.com/input-output-hk/midnight-passport-sdk/issues/261); retain original intent/ciphertext/receipt, never blind replay; design/implementation pending |
| Bootstrap wiring escapes type/port validation before native setup | P2 | [#263](https://github.com/input-output-hk/midnight-passport-sdk/issues/263); initial shared proving bridge, offline HD/ledger preflight and early actual-prover validation implemented locally; five fast tests, optional real-consumer probe passed; native rerun not claimed |
| Large duplicated lifecycle closures | P2 | [#264](https://github.com/input-output-hk/midnight-passport-sdk/issues/264); incremental operation extraction with two-arm invariant coverage, preserve crypto/consent/API |
| Nonfinite timing values can make polling unbounded | P3 | [#234](https://github.com/input-output-hk/midnight-passport-sdk/issues/234), [#262](https://github.com/input-output-hk/midnight-passport-sdk/issues/262); finite safe integer/timer-range guards and no-side-effect tests committed locally in `db41991` |

The umbrella [#262](https://github.com/input-output-hk/midnight-passport-sdk/issues/262)
tracks improvement acceptance. Existing broad trackers are reused rather than duplicated.
Prioritize reproducible defects, then early composition checks and incremental refactors.
No new confirmed crypto/fund-loss/artifact-integrity bug was identified in this bounded audit;
that does not establish their absence. Deliberately permissive hosted result-status parsing
mirrors the pinned upstream host and requires a separate port-contract design, not an unverified
"fix" changing supported host behavior.

## Verification and CI policy

The original malformed target crash was reproduced in an isolated Node22 process under Nix.
Regression sends raw requests to an ephemeral loopback server, verifies route noninvocation and
same-process recovery. Deposit recovery reproduction uses a fake sender with one retained effect;
no duplicate spend is claimed. Timing failures are caller-configured options, not remote params.

Keep cheap deterministic tests in required CI and actual installs/browser/native/image work opt-in.
PR259 measured substantive jobs23–50seconds; the longest two test shards exceed the30–45second
target and should be tuned from actual timing data without removing coverage or integrity gates.
Private synthetic state, wallets, witnesses and auth never enter caches or public reports.
