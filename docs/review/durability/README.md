# Local mutation durability and grant-bookkeeping recovery

Issues #230 and #239. Unreleased work on the existing `codex/rc5-publication-record`
branch, following signed consumer source `2ffb0af`. No GitHub issue closure,
push, publication, chain reset or host implementation change is authorised here.

## Review in order

1. [Engineer guide](../../site/durability.md): state machine, requirements, examples,
   storage version policy, cancellation and explicit refusal boundaries.
2. `packages/account/src/mutation-types.ts`, `mutation-codec.ts`,
   `mutation-ledger.ts`: typed protected state, canonical bounded codec, immutable
   binding pin and predicted complete ACC mutation frontier.
3. `packages/account/src/durable-mutations.ts`: original-intent replay, per-invocation
   approval, write-ahead effects, exact receipts, frontier checks and final local
   record/directory reconciliation. Public audit is a narrow allowlist.
4. `packages/keys/src/mutation-journal.ts` and
   `packages/service/src/mutation-store.ts`: domain-separated AES-GCM and local
   POSIX immutable revision publication, fsync, CAS races and corruption refusal.
5. `packages/account/src/grant-bookkeeping-recovery.ts`,
   `grant-opening-check.ts`: authenticated reconstruction without fabricated scope
   or signing capability; the existing staged path shares its commitment verifier.
6. Demo composition: original local grant journal first, published-record fallback
   second. Full staged-opening export still requires its original journal. Existing
   journal v1/v2 reads remain; decrypted temporary bytes are cleared.
7. Tests and the offline matrix below; source fingerprints are part of its receipt.

## Concrete safety decisions

- A failed call can have broadcast already. Keep its exact intent and do not
  automatically resubmit until the host supplies an exact final receipt or a
  definitive no-send outcome that fences earlier senders.
- An observed nonce change, inbox entry or current encryption key alone is not
  an authoritative transaction receipt. Both receipt and expected full state
  must agree. Stale or concurrently changed frontiers refuse further effects.
- Save outputs before publishing them. A crash between key computation and its
  durable output acknowledgement **refuses** without another key draw. The generic
  key port cannot make this window transparently recoverable.
- Credential enrolment has the same uncertainty rule. This composition requires
  an existing selected key origin; it does not claim durable native WebAuthn enrolment.
- Cancellation preserves outstanding effects and keys. It cannot undo a submitted
  transaction. Resumption requires a fresh approval of the original lock/reader choice.
- Missing final local hints may be restored after exact chain reconciliation;
  conflicting records cannot be silently overwritten.
- Published grant/object records require the original reader and live commitments.
  A second enrolled reader or a missing part cannot yield invented salts or full
  issue scope. Conflicting generations/records refuse rather than pick “latest.”
- Private continuation documents and capability openings are never event payloads.
  No backup/import/export surface was added. Existing explicit owner handoff stays
  distinct from public audit and still checks its complete staged opening.

## Qualification

Default tests cover selected fresh-process cases, cancellation and unknown send
refusal, no replacement generation, exact original lock intent, original pins,
unfenced senders, corrupt/pin/version failures, encrypted persistence, key-byte
cleanup and concurrent CAS. Grant tests exercise profile loss/reload, another
actually enrolled reader, missing/conflicting parts, revoked/replaced grants,
wrong origin, mid-read chain change, lagging commitments, reconstructed active
read delivery and the missing-opening rotation guard. Existing suite 1/2 and
v1/v2 journal tests remain required.

The full crash matrix is deliberately outside the required fast lane:

```sh
nix develop -c pnpm run build
nix develop -c node scripts/qualification/mutation-matrix.mjs /private/evidence/mutations.json
```

Every crash case starts a new worker, executes the shipped generated contract
with software P-256/JubJub signatures, restarts from its protected journal and
checks no duplicate effects/replacement generation and intended reader access.
It instruments submissions and receipt acknowledgement before/after activation,
inbox publication, key switch, enrollment and removal, as well as credential and
sealed-output computation/commit boundaries. The receipt distinguishes expected
key-origin refusals from resumed cases. It binds the exact module and relevant
source/runtime bytes and rejects changes during the run.

No proofs, fees or funds move in this fixture. Its local atomic transport knows
which calls were sent; it must never be copied as a remote “missing means not
submitted” policy. The combined matrix has an empty active read-grant roster;
active grant preservation/refusal is independently tested, not represented as
full mixed-grant live interruption acceptance.

## Remaining acceptance

#230 remains open for host-owned submission fencing/receipt storage and durable
multi-wave deployment integration, real provider/proof interruption tests and
combined active-grant/holdings fault scenarios. The ordinary browser composition
has not been silently switched to this API. Uncommitted key-origin output loss
is explicitly unsupported and safely refused.

#239's local supported reconstruction path is an owner-review candidate. Complete
published parts under the original reader can be recovered; full staged scope,
private grantee keys and unpublished openings cannot be reconstructed. A new
consented encrypted backup/import UX is a separate choice, not a hidden export.
No remote issue closure was performed. The acceptance index retains each issue's
original criteria and records the narrower verification scope.

The immutable binding, exact-value shielded guard and hosted consent scopes are
unchanged. No general total-loss recovery, complete compromised-key retirement
or full Lace compatibility claim is made. The final signed checkpoint and redacted
receipts are kept in the owner's Midnight Obsidian milestone hub.

## Final local results

[Redacted verification](verification.json): 200 fresh-process crash cases passed
(100 per arm): 158 resumptions and 42 expected key-origin-window refusals. All
expected outcomes are counted; refusals are not labelled successful resumptions.
Full local gate: 839 passes, seven existing conditional skips, zero failures.
Jekyll: 17 pages and 316 local links/anchors; integration example type-checks.
Required hosted CI timing remains unmeasured; no workflow was dispatched.
