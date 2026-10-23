# External review adjudication — 2026/10/23

The initial read-only reviews covered PR #248 at `2ffb0af` and #249 at `5f1c103`.
Each finding was checked against the code; the reviewer did not execute tests.

| Finding | Disposition |
| --- | --- |
| Unanchored earlier envelope used to identify a removal target | Fixed: current ledger-matching roster only; negative tests in both arms. Legacy interruption limitation documented |
| Opaque/unregistered removal target refuses | Retained safety boundary: cannot establish distinct grant recipients; full identity revocation needs binding work |
| Ignored compiled runtime absent from source identity | Fixed: include actual package dist files and reject compiled symlinks; pre-build remains required |
| Three supplied receipts prove no intervening failures | Claim corrected: chronological/matching/distinct only; omitted runs are unaudited |
| Historical roster cap may throw plain error | History is no longer consulted for target authorisation; diagnostic port remains bounded |
| Private consumer evidence vs unimplemented generic registry lane | Retain evidence tiers: authorized concrete manual consumers do not implement the generic release registry gate |
| Evidence output inside source changes source hash | Documented: use private external/ignored roots; no exception excludes arbitrary files from hashing |
| Cold CI five-minute budget speculative | Initial measured runs green at 65/81 s; warm target missed, no cold-run guarantee claimed |
| Standing rule placement and old date/log labels | Cosmetic; preserve user-approved workflow and correct the compatibility date; no extra scope-wide rewrite |
| Abort after dispatch CAS prevents the committed send | Fixed: CAS is point of no return; finish that dispatch, stop later steps; dedicated test |
| Saved native bytes may expire before dispatch | Refuse expired constructor/ready bytes before proof/dispatch. No renewal/replay or full expiry recovery claim |
| Lost uncommitted constructor should be regenerated | Rejected: would replace the original randomized address/authority. Preserve unknown state |
| Unknown lookup polls retain full encrypted revisions | Fixed: no new owner claim for lookup-only polls; unchanged revision regression |
| Later unrelated ledger state should be accepted as a prefix | Rejected: original future effects would run against unapproved changed state. Exact frontier refusal retained |
| Shared queue and cancellation limitations | Retained bounded single-wallet topology; per-call cancellation propagation remains limited; no unlimited/concurrent throughput claim |
| Direct/reconciled deploy receipt asymmetry | Fixed using shared validation and direct-path regressions |
| Existing conflicting directory pointer should be overwritten | Rejected: address-open verifies the requested live ACC and preserves write-once untrusted hints; credential lookup may still need operator reconciliation |
| Default tests omit all durable operations | Broader opt-in matrix already covered all four kinds; new populated matrix covers rotate/add/remove; representative fast tests are not exhaustive claims |
| Dynamic reference imports use broad structural types | Acknowledged integration typing debt; native object/hash/receipt checks and tests remain the runtime boundary |

No issue was closed, binding repinned, shielded partial spend enabled, release published or
blanket host/provider compatibility asserted by these corrections.
