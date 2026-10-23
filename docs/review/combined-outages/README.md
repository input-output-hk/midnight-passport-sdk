# Combined grants/holdings and prover-outage qualification

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

- Earlier envelopes can carry sender-chosen secrets. The old history fallback no longer
  authenticates a removal target. Missing current target metadata refuses; original
  protected continuations can retain the original verified snapshot. No identity-revocation claim.
- Qualification hashes ignored compiled inputs. Three matching ordered local receipts
  do not audit omitted intervening runs; old receipts retain their narrower original scope.
- Unknown host polls are read-only. A successor claims only before preparing, and CAS
  still fences stale prepared results. Dispatch CAS is the cancellation point of no return.
- Native expired constructor/ready bytes refuse before proof/dispatch without renewal.
  Expiry recovery, lost uncommitted constructors and unknown sends remain unsupported.
- Direct and reconciled deploy results share address, nonempty ID, zero nonce/device and
  original encryption-key/frontier validation.

External suggestions to regenerate constructors, accept arbitrary later ledger prefixes,
resend unknown transactions, infer no-send from absence or overwrite conflicting directory
hints were rejected because they weaken the original consent/intent/receipt boundary.
Dynamic reference types and real-provider acceptance remain separate limitations. Report
hosted CI measurements honestly; the 30–45 s warm target has not yet been met.

Final accepted counts and evidence will be recorded in `verification.json` after the
current-source live/offline runs finish. Failed development attempts retain original
journals/IDs privately; they never become clean evidence. No user funds or passkeys are used.
