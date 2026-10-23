# External review adjudication — 2026/10/23

The initial read-only reviews covered PR #248 at `2ffb0af` and #249 at `5f1c103`.
Each finding was checked against the code; the reviewer did not execute tests.

| Finding | Disposition |
| --- | --- |
| Unanchored earlier envelope used to identify a removal target | Fixed: remove history fallback/API; refuse unresolved legacy interleaving; retain original protected-continuation support; bounded decryption candidates cannot evict genuine older coin keys |
| Opaque/unregistered removal target refuses | Retained safety boundary: cannot establish distinct grant recipients; full identity revocation needs binding work |
| Ignored compiled runtime absent from source identity | Fixed: include actual package dist files and reject compiled symlinks; pre-build remains required |
| Three supplied receipts prove no intervening failures | Claim corrected: chronological/matching/distinct only; omitted runs are unaudited |
| Historical roster cap may throw plain error | History is no longer consulted for target authorisation; obsolete history port removed |
| Private consumer evidence vs unimplemented generic registry lane | Retain evidence tiers: authorized concrete manual consumers do not implement the generic release registry gate |
| Evidence output inside source changes source hash | Documented: use private external/ignored roots; no exception excludes arbitrary files from hashing |
| Cold CI five-minute budget speculative | First runs green at 65/81 s; separated gates later measured 24–40 s; no universal cold-run guarantee claimed |
| Standing rule placement and old date/log labels | Cosmetic; preserve user-approved workflow and correct the compatibility date; no extra scope-wide rewrite |
| Abort after dispatch CAS prevents the committed send | Fixed: CAS is point of no return; finish that dispatch, stop later steps; dedicated test |
| Saved native bytes may expire before dispatch | Refuse expired constructor/ready bytes before proof/dispatch. No renewal/replay or full expiry recovery claim |
| Lost uncommitted constructor should be regenerated | Rejected: would replace the original randomized address/authority. Preserve unknown state |
| Unknown lookup polls retain full encrypted revisions | Fixed: no new owner claim for lookup-only polls; unchanged revision regression |
| Later unrelated ledger state should be accepted as a prefix | Rejected: original future effects would run against unapproved changed state. Exact frontier refusal retained |
| Shared queue and cancellation limitations | Retained bounded single-wallet topology; correlated cancellation now propagates; no unlimited/concurrent throughput claim |
| Direct/reconciled deploy receipt asymmetry | Fixed using shared validation and direct-path regressions |
| Existing conflicting directory pointer should be overwritten | Rejected: address-open verifies the requested live ACC and preserves write-once untrusted hints; credential lookup may still need operator reconciliation |
| Default tests omit all durable operations | Broader opt-in matrix already covered all four kinds; new populated matrix covers rotate/add/remove; representative fast tests are not exhaustive claims |
| Dynamic reference imports use broad structural types | Acknowledged integration typing debt; native object/hash/receipt checks and tests remain the runtime boundary |

No issue was closed, binding repinned, shielded partial spend enabled, release published or
blanket host/provider compatibility asserted by these corrections.

## Follow-up verification

The next read-only reviews confirmed the first four host corrections. Further verified
fixes now cover unknown wave-boundary polls, cancellation forwarding into correlated
host calls/reconciliation, preserving cancelled state after an unresolved explicit
resume, and a ten-second native TTL margin. A cancelled preparation deliberately
retains its computed output, even if it later expires; discarding or replacing those
bytes would contradict this journal's preservation contract. Source preflight precedes
evidence reservation and rejects a symlinked dist root as well as symlinked entries.

Generic outer receipt matching still needs scenario-specific external input evidence;
it is not a complete release provenance gate. No automatic expiry/unknown-send repair
or full compromised-identity revocation was added. Public setup uses a single reference
wallet and decodes native contract state with that handle's physical runtime.

## Final removal decision — 2026/10/24

The retained-current-target-registration experiment was withdrawn. An intervening
rotation could reinclude that still-live target as a fresh-key recipient. Fresh legacy
retry and interleaved rotations now refuse the unresolved current roster; the explicit
protected original coordinator remains the supported continuation path. This is an
intentional limitation rather than a new on-chain registration format. A regression
checks no key/inbox change on both-arm legacy refusals. Package-root symlinks and
obsolete API guidance are fixed.

## Final candidate and CI correction — 2026/10/24

The global sixteen-key overflow refusal is withdrawn: anonymous envelopes must not
lock current account access or evict a genuine old coin key. Keep all distinct earlier
decryption candidates within the existing 4096-envelope limit, zero them after use, and
authenticate metadata only with the ledger-matching current secret/roster. A genuine old
coin behind seventeen forged envelopes remains readable through inbox/coin APIs while
current metadata, device delivery and new key creation remain usable. Candidate-by-coin
work at the existing 4096 limits still requires resource qualification.

Restore an explicit minimum of four test files before each of the four CI shards.
The actual Node guard refuses an empty directory; every shard and the aggregate must
succeed. No skipped/empty runner is counted as qualification.
