# Combined grants/holdings and prover-outage qualification

**Historical-source qualification:** dated receipts below retain their original
source/compiled hashes and test assertions. The 2026/10/26 host-preparation and
harness corrections are not retroactively qualified by those receipts. Original
codes can be audited separately; new live checks require separate source evidence.

2026/10/23. Refs #230/#231/#232/#239. This slice extends the declared source/software-identity
scope; it does not close broad issues or qualify a release, real provider or hosted wallet.

## Review order

1. `scripts/qualification/mutation-worker.mjs`: populated offline fixture uses the actual
   pinned grant map, native recomputed coin commitment, real sealing/opening, surviving
   and removed readers. The history/event transport and Merkle index are synthetic.
2. `mutation-matrix.mjs`: exhaustive fresh-process boundaries for rotation, enrollment
   and removal in both arms. Separate roots; original IDs, effects and key generation.
   Representative receipt-loss/unknown-outcome tests remain in the fast lane.
3. `apps/passport-service/qualification/live-worker.ts`: dedicated real localnet composition.
   Setup uses one wallet, its own physical ledger decoder and directory-only transport,
   staged grant openings and a write-ahead shielded coin intent. No shared demo state.
4. `scripts/qualification/live-outages.mjs` / `live-combined.mjs`: actual owned prover stops,
   original saved deployment-plan continuation, populated rotation with post-submit host
   death/indexer stop, and explicit no-resend refusal after pre-registration owner proof
   failure. Source/runtime, reference and container/image fingerprints remain required.
5. [Engineer guide](../../site/live-qualification.md) and [compatibility](../../compatibility.md).

## Review corrections carried into the lower stack

- Earlier envelopes can carry sender-chosen secrets. The old history fallback/API and
  retained-target-metadata experiment are withdrawn. Legacy retry/interleaved rotations
  refuse an unresolved current roster; an original protected continuation retains its
  verified snapshot. All distinct historical decryption candidates within the existing
  envelope bound remain available for older holdings; they never authenticate metadata.
- Qualification hashes ignored compiled inputs. Three matching ordered local receipts
  do not audit omitted intervening runs; old receipts retain their narrower original scope.
- Unknown host lookup and wave-boundary polls are read-only. A successor claims only before preparing, and CAS
  still fences stale prepared results. Dispatch CAS is the cancellation point of no return.
- Native expired constructor/ready bytes refuse before proof/dispatch without renewal.
  Expiry recovery, lost uncommitted constructors and unknown sends remain unsupported.
- Cancellation reaches correlated submit/reconciliation; failed explicit resume retains
  cancellation. Direct and reconciled deploy results share address, nonempty ID, zero nonce/device and
  original encryption-key/frontier validation.

External suggestions to regenerate constructors, accept arbitrary later ledger prefixes,
resend unknown transactions, infer no-send from absence or overwrite conflicting directory
hints were rejected because they weaken the original consent/intent/receipt boundary.
Dynamic reference types and real-provider acceptance remain separate limitations. Report
hosted CI measurements honestly; the separated gates measured 24–40 seconds at
`e901270`. At `2dab5eb`, including the nonempty-file guard, all gates passed:
lint 16 s, full build/types 33 s, apps 37 s, package shards 18–44 s and aggregate 2 s.
These are measured hosted runs, not a universal cold-cache timing guarantee.

Final scoped acceptance is recorded in [verification.json](verification.json). Failed development attempts retain original
journals/IDs privately; they never become clean evidence. No user funds or passkeys are used.

## Accepted evidence — 2026/10/24

- Frozen live source `06dbdc6`: one both-arm round, two ACCs, 16 passed case
  entries, 34 host-confirmed transactions and zero duplicate host sends. Each arm
  had one active read grant and one seven-unit shielded test holding. Original plans
  and prepared bytes survived. Four actual prover stops, two post-submit process
  deaths and two actual indexer-outage probes were exercised.
- Offline owner matrix: 200 cases (158 resumed, 42 safe key-origin refusals).
  Populated rotate/add/remove matrix: 260 (200 resumed, 60 safe key-origin refusals).
  Both use fresh processes and four bounded independent roots per batch. The corrected
  harness was run in a dedicated ancillary checkout; all listed source/dist hashes
  match this branch. Synthetic host matrix: 152 (108 resumed, 44 safely unknown);
  every listed source/dist hash still matches, so its narrower original receipt is retained.
- Full local gate: 870 passed, seven existing conditional skips, zero failures.
  Jekyll and local links/anchors checked. The frozen-source hosted run passed with
  core jobs 20–45 seconds; final PR head checks remain visible on GitHub.

The owner pre-registration prover failure is a **safe unresolved refusal**, not
automatic recovery. Legacy interrupted removal still requires the original protected
continuation. Real providers/two-device lifecycle, live enrollment/removal, the entire
release suite, published consumers/images and resource qualification at maximum inbox
bounds remain separate acceptance. Broader issues remain open. The final forward
changes affect docs/CI lineage and the exact expected error code in the offline matrix;
the live harness and SDK executable inputs are unchanged from the accepted freeze.
